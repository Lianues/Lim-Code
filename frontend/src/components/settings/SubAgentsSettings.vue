<script setup lang="ts">
/**
 * SubAgentsSettings - 子代理设置面板
 *
 * 功能：
 * 1. 管理子代理配置（新建、编辑、删除）
 * 2. 配置子代理的系统提示词
 * 3. 选择子代理使用的渠道和模型
 * 4. 配置子代理可用的工具列表
 */

import { ref, computed, onMounted } from 'vue'
import { CustomSelect, CustomCheckbox, ConfirmDialog, type SelectOption } from '../common'
import { sendToExtension } from '@/utils/vscode'
import { useI18n } from '@/i18n'
import type { ModelInfo } from '@/types'

const { t } = useI18n()

// ==================== 类型定义 ====================

// Provider 自动重试耗尽后的处理策略。
// 修改原因：设置页需要同时编辑全局默认策略和单个 SubAgent 覆盖策略。
// 修改方式：在前端声明与后端一致的稳定枚举，供 CustomSelect 选项和保存逻辑复用。
// 修改目的：避免 UI 中散落字符串常量，后续 Monitor 状态机接入时仍保持同一语义。
type FailureModeAfterRetries = 'fail_parent_tool' | 'wait_for_monitor_action'

// 子代理工具配置
interface SubAgentToolsConfig {
  mode: 'all' | 'builtin' | 'mcp' | 'whitelist' | 'blacklist'
  whitelist?: string[]
  blacklist?: string[]
  includeMcp?: boolean
}

// 子代理配置
interface SubAgentConfig {
  type: string
  name: string
  description: string
  systemPrompt: string
  channel: {
    channelId: string
    modelId?: string
  }
  tools: SubAgentToolsConfig
  maxIterations?: number
  maxRuntime?: number
  failureModeAfterRetries?: FailureModeAfterRetries
  enabled?: boolean
}

// 渠道配置
interface ChannelConfig {
  id: string
  name: string
  type: string
  enabled: boolean
  model: string
  models: ModelInfo[]
}

// 工具信息
interface ToolInfo {
  name: string
  description: string
  category?: string
  source: 'builtin' | 'mcp'
  serverId?: string
}

// ==================== 状态 ====================

// 全局配置
const maxConcurrentAgents = ref(3)
// 修改原因：Provider 自动重试耗尽后的默认处理策略属于 SubAgents 全局配置。
// 修改方式：用独立 ref 保存后端运行时补齐后的全局默认值，并通过 updateGlobalConfig 写回 limcode.toolsConfig.subagents。
// 修改目的：继续复用 VS Code Settings Sync，不新增并行存储。
const globalFailureModeAfterRetries = ref<FailureModeAfterRetries>('fail_parent_tool')

// 子代理列表
const subAgents = ref<SubAgentConfig[]>([])
const currentAgentType = ref<string>('')
const isLoading = ref(false)

// 编辑模式
const isEditing = ref(false)
const editingName = ref('')
const renameError = ref('')

// 新建对话框
const showNewDialog = ref(false)
const newAgentName = ref('')
const isCreating = ref(false)
const createError = ref('')

// 删除确认
const showDeleteConfirm = ref(false)
const deleteAgentType = ref('')

// 渠道列表
const channels = ref<ChannelConfig[]>([])
const isLoadingChannels = ref(false)

// 工具列表
const allTools = ref<ToolInfo[]>([])
const isLoadingTools = ref(false)

// ==================== 计算属性 ====================

// 当前选中的子代理
const currentAgent = computed(() => 
  subAgents.value.find(a => a.type === currentAgentType.value)
)

// 子代理下拉选项
const agentOptions = computed<SelectOption[]>(() =>
  subAgents.value.map(agent => ({
    value: agent.type,
    label: agent.name,
    description: agent.enabled === false ? t('components.settings.subagents.disabled') : ''
  }))
)

// 已启用的渠道选项
const channelOptions = computed<SelectOption[]>(() =>
  channels.value
    .filter(c => c.enabled)
    .map(c => ({
      value: c.id,
      label: c.name,
      description: c.type
    }))
)

// 当前选择的渠道
const selectedChannel = computed(() =>
  channels.value.find(c => c.id === currentAgent.value?.channel.channelId)
)

// 当前渠道的模型选项
const modelOptions = computed<SelectOption[]>(() => {
  if (!selectedChannel.value?.models) return []
  return selectedChannel.value.models.map(m => ({
    value: m.id,
    label: m.name || m.id,
    description: m.description
  }))
})

// Provider 自动重试耗尽后的策略选项
const failureModeOptions = computed<SelectOption[]>(() => [
  {
    value: 'fail_parent_tool',
    label: t('components.settings.subagents.failureMode.failParentTool'),
    description: t('components.settings.subagents.failureMode.failParentToolDescription')
  },
  {
    value: 'wait_for_monitor_action',
    label: t('components.settings.subagents.failureMode.waitForMonitorAction'),
    description: t('components.settings.subagents.failureMode.waitForMonitorActionDescription')
  }
])

// 工具模式选项
const toolModeOptions = computed<SelectOption[]>(() => [
  { value: 'all', label: t('components.settings.subagents.toolMode.all') },
  { value: 'builtin', label: t('components.settings.subagents.toolMode.builtin') },
  { value: 'mcp', label: t('components.settings.subagents.toolMode.mcp') },
  { value: 'whitelist', label: t('components.settings.subagents.toolMode.whitelist') },
  { value: 'blacklist', label: t('components.settings.subagents.toolMode.blacklist') }
])

// 内置工具列表
const builtinTools = computed(() => 
  allTools.value.filter(t => t.source === 'builtin')
)

// MCP 工具列表
const mcpTools = computed(() => 
  allTools.value.filter(t => t.source === 'mcp')
)

// 当前工具列表（白名单或黑名单）
const currentToolList = computed(() => {
  const mode = currentAgent.value?.tools.mode
  if (mode === 'whitelist') {
    return currentAgent.value?.tools.whitelist || []
  } else if (mode === 'blacklist') {
    return currentAgent.value?.tools.blacklist || []
  }
  return []
})

// 检查工具是否被选中
function isToolSelected(toolName: string): boolean {
  return currentToolList.value.includes(toolName)
}

// 切换工具选中状态
async function toggleTool(toolName: string, selected: boolean) {
  if (!currentAgent.value) return
  
  const mode = currentAgent.value.tools.mode
  const listKey = mode === 'whitelist' ? 'whitelist' : 'blacklist'
  const currentList = [...(currentAgent.value.tools[listKey] || [])]
  
  if (selected) {
    if (!currentList.includes(toolName)) {
      currentList.push(toolName)
    }
  } else {
    const index = currentList.indexOf(toolName)
    if (index > -1) {
      currentList.splice(index, 1)
    }
  }
  
  await updateAgentField('tools', {
    ...currentAgent.value.tools,
    [listKey]: currentList
  })
}

// ==================== 方法 ====================

// 加载子代理列表和全局配置
async function loadSubAgents() {
  isLoading.value = true
  try {
    const response = await sendToExtension<{ agents: SubAgentConfig[], maxConcurrentAgents?: number, failureModeAfterRetries?: FailureModeAfterRetries }>('subagents.list', {})
    if (response?.agents) {
      subAgents.value = response.agents
      // 加载全局配置
      if (response.maxConcurrentAgents !== undefined) {
        maxConcurrentAgents.value = response.maxConcurrentAgents
      }
      // 修改原因：旧后端或旧配置可能不返回该字段，设置页仍需要有安全默认值。
      // 修改方式：读取后端运行时补齐值；缺失时回退到 fail_parent_tool。
      // 修改目的：保持“默认立刻失败”的语义，并避免 UI 出现空选项。
      globalFailureModeAfterRetries.value = response.failureModeAfterRetries || 'fail_parent_tool'
      // 如果有代理但没有选中，选中第一个
      if (subAgents.value.length > 0 && !currentAgentType.value) {
        currentAgentType.value = subAgents.value[0].type
      }
    }
  } catch (error) {
    console.error('Failed to load subagents:', error)
  } finally {
    isLoading.value = false
  }
}

function normalizeFailureMode(value: unknown): FailureModeAfterRetries {
  // 修改原因：CustomSelect 事件值来自通用组件，类型层面是 unknown/string，不能直接信任。
  // 修改方式：集中校验两个设计确认的枚举值，非法值回退到安全默认 fail_parent_tool。
  // 修改目的：避免错误配置写入 Settings Sync，并确保后续运行状态机只处理已知策略。
  return value === 'wait_for_monitor_action' ? 'wait_for_monitor_action' : 'fail_parent_tool'
}

// 更新全局配置
async function updateGlobalConfig(key: string, value: unknown) {
  try {
    await sendToExtension('subagents.updateGlobalConfig', { [key]: value })
  } catch (error) {
    console.error('Failed to update global config:', error)
  }
}

async function updateGlobalFailureMode(value: unknown) {
  // 修改原因：全局失败策略需要先更新本地 UI，再写入现有 subagents 全局配置。
  // 修改方式：通过 normalizeFailureMode 收敛值域，然后复用 updateGlobalConfig。
  // 修改目的：保持 UI 响应即时，同时不绕过后端的枚举校验。
  const mode = normalizeFailureMode(value)
  globalFailureModeAfterRetries.value = mode
  await updateGlobalConfig('failureModeAfterRetries', mode)
}

async function updateAgentFailureMode(value: unknown) {
  // 修改原因：单个 SubAgent 可以覆盖全局默认策略，但旧配置缺失字段时不能因读取而主动写回。
  // 修改方式：只有用户在选择框中明确修改时，才通过 updateAgentField 持久化该字段。
  // 修改目的：满足“运行时补齐，不主动写回”的兼容要求。
  await updateAgentField('failureModeAfterRetries', normalizeFailureMode(value))
}

// 加载渠道列表
async function loadChannels() {
  isLoadingChannels.value = true
  try {
    const ids = await sendToExtension<string[]>('config.listConfigs', {})
    const loadedChannels: ChannelConfig[] = []
    
    for (const id of ids || []) {
      const config = await sendToExtension<ChannelConfig>('config.getConfig', { configId: id })
      if (config) {
        loadedChannels.push(config)
      }
    }
    
    channels.value = loadedChannels
  } catch (error) {
    console.error('Failed to load channels:', error)
  } finally {
    isLoadingChannels.value = false
  }
}

// 加载工具列表
async function loadTools() {
  isLoadingTools.value = true
  try {
    // 加载内置工具
    const builtinResponse = await sendToExtension<{ tools: any[] }>('tools.getTools', {})
    const builtinTools: ToolInfo[] = (builtinResponse?.tools || []).map(t => ({
      ...t,
      source: 'builtin' as const
    }))
    
    // 加载 MCP 工具
    const mcpResponse = await sendToExtension<{ tools: any[] }>('tools.getMcpTools', {})
    const mcpTools: ToolInfo[] = (mcpResponse?.tools || []).map(t => ({
      name: t.name,
      description: t.description || '',
      category: 'mcp',
      source: 'mcp' as const,
      serverId: t.serverId
    }))
    
    allTools.value = [...builtinTools, ...mcpTools]
  } catch (error) {
    console.error('Failed to load tools:', error)
  } finally {
isLoadingTools.value = false
  }
}

// 选择子代理
function selectAgent(agentType: string) {
  currentAgentType.value = agentType
}

// 更新当前代理配置
async function updateAgentField(field: string, value: any) {
  if (!currentAgent.value) return
  
  try {
    await sendToExtension('subagents.update', {
      type: currentAgentType.value,
      updates: { [field]: value }
    })
    
    // 更新本地状态
    const agent = subAgents.value.find(a => a.type === currentAgentType.value)
    if (agent) {
      (agent as any)[field] = value
    }
  } catch (error) {
    console.error('Failed to update subagent:', error)
  }
}

// 打开新建对话框
function openCreateDialog() {
  newAgentName.value = ''
  createError.value = ''
  showNewDialog.value = true
}

// 生成唯一的子代理类型 ID
function generateAgentTypeId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 6)
  return `agent_${timestamp}_${random}`
}

// 创建子代理
async function createAgent() {
  const trimmedName = newAgentName.value.trim()
  
  if (!trimmedName) {
    createError.value = t('components.settings.subagents.createDialog.nameRequired')
    return
  }
  
  // 本地检查名称是否重复
  const nameExists = subAgents.value.some(
    a => a.name.toLowerCase() === trimmedName.toLowerCase()
  )
  if (nameExists) {
    createError.value = t('components.settings.subagents.createDialog.nameDuplicate')
    return
  }
  
  isCreating.value = true
  createError.value = ''
  
  // 自动生成类型 ID
  const agentTypeId = generateAgentTypeId()
  
  try {
    await sendToExtension('subagents.create', {
      type: agentTypeId,
      name: trimmedName,
      description: '',
      systemPrompt: '',
      channel: { channelId: '' },
      tools: { mode: 'all' },
      // 修改原因：产品要求每个新建 SubAgent 默认在 Provider 自动重试耗尽后立刻让主窗口工具失败。
      // 修改方式：创建请求显式传入 fail_parent_tool，后端也会兜底同一默认值。
      // 修改目的：即使全局默认后续被用户改为等待，新建代理仍有清晰的单代理默认策略。
      failureModeAfterRetries: 'fail_parent_tool',
      enabled: true
    })
    
    // 重新加载并选中新创建的
    await loadSubAgents()
    currentAgentType.value = agentTypeId
    showNewDialog.value = false
  } catch (error: any) {
    console.error('Failed to create subagent:', error)
    // 检查是否是名称重复错误
    if (error?.message?.includes('SUBAGENT_NAME_EXISTS') || error?.code === 'SUBAGENT_NAME_EXISTS') {
      createError.value = t('components.settings.subagents.createDialog.nameDuplicate')
    } else {
      createError.value = error?.message || String(error)
    }
  } finally {
    isCreating.value = false
  }
}

// 开始重命名
function startRename() {
  if (!currentAgent.value) return
  editingName.value = currentAgent.value.name
  renameError.value = ''
  isEditing.value = true
}

// 保存重命名
async function saveRename() {
  const trimmedName = editingName.value.trim()
  
  if (!trimmedName) {
    isEditing.value = false
    return
  }
  
  // 检查名称是否重复（排除当前代理）
  const nameExists = subAgents.value.some(
    a => a.type !== currentAgentType.value && a.name.toLowerCase() === trimmedName.toLowerCase()
  )
  if (nameExists) {
    renameError.value = t('components.settings.subagents.createDialog.nameDuplicate')
    return
  }
  
  try {
    await updateAgentField('name', trimmedName)
    isEditing.value = false
    renameError.value = ''
  } catch (error: any) {
    if (error?.message?.includes('SUBAGENT_NAME_EXISTS') || error?.code === 'SUBAGENT_NAME_EXISTS') {
      renameError.value = t('components.settings.subagents.createDialog.nameDuplicate')
    } else {
      renameError.value = error?.message || String(error)
    }
  }
}

// 取消重命名
function cancelRename() {
  isEditing.value = false
  editingName.value = ''
  renameError.value = ''
}

// 删除子代理
async function deleteAgent() {
  if (!deleteAgentType.value) return
  
  try {
    await sendToExtension('subagents.delete', { type: deleteAgentType.value })
    
    // 从列表中移除
    subAgents.value = subAgents.value.filter(a => a.type !== deleteAgentType.value)
    
    // 如果删除的是当前选中的，选择第一个
    if (currentAgentType.value === deleteAgentType.value) {
      currentAgentType.value = subAgents.value[0]?.type || ''
    }
  } catch (error) {
    console.error('Failed to delete subagent:', error)
  } finally {
    showDeleteConfirm.value = false
    deleteAgentType.value = ''
  }
}

// 初始化
onMounted(async () => {
  await Promise.all([
    loadSubAgents(),
    loadChannels(),
    loadTools()
  ])
})
</script>

<template>
  <div class="subagents-settings">
    <!-- 加载中 -->
    <div v-if="isLoading" class="loading-state">
      <i class="codicon codicon-loading codicon-modifier-spin"></i>
      <span>{{ t('common.loading') }}</span>
    </div>
    
    <!-- 主内容 -->
    <div v-else class="settings-content">
      <!-- 全局配置 -->
      <div class="config-section global-config">
        <h5>{{ t('components.settings.subagents.globalConfig') }}</h5>
        <div class="form-row">
          <div class="form-group flex-1">
            <label>{{ t('components.settings.subagents.maxConcurrentAgents') }}</label>
            <input
              type="number"
              :value="maxConcurrentAgents"
              min="1"
              @change="maxConcurrentAgents = parseInt(($event.target as HTMLInputElement).value) || 3; updateGlobalConfig('maxConcurrentAgents', maxConcurrentAgents)"
            />
            <span class="field-hint">{{ t('components.settings.subagents.maxConcurrentAgentsHint') }}</span>
          </div>
          <div class="form-group flex-1">
            <label>{{ t('components.settings.subagents.failureMode.globalLabel') }}</label>
            <!--
              修改原因：用户需要配置 Provider 自动重试耗尽后，SubAgent 主工具是立即失败还是等待 Monitor 手动处理。
              修改方式：复用现有 CustomSelect，值写入 limcode.toolsConfig.subagents.failureModeAfterRetries。
              修改目的：不新增设置存储机制，同时保持全局默认策略可同步。
            -->
            <CustomSelect
              :modelValue="globalFailureModeAfterRetries"
              :options="failureModeOptions"
              @update:modelValue="updateGlobalFailureMode"
            />
            <span class="field-hint">{{ t('components.settings.subagents.failureMode.globalHint') }}</span>
          </div>
        </div>
      </div>
      
      <!-- 子代理选择器 -->
      <div class="agent-selector">
        <CustomSelect
          v-if="agentOptions.length > 0"
          :modelValue="currentAgentType"
          :options="agentOptions"
          :placeholder="t('components.settings.subagents.selectAgent')"
          @update:modelValue="selectAgent"
        />
        <div v-else class="no-agents">
          <span>{{ t('components.settings.subagents.noAgents') }}</span>
        </div>
        
        <!-- 操作按钮 -->
        <div class="agent-actions">
          <button class="action-btn" @click="openCreateDialog" :title="t('components.settings.subagents.create')">
            <i class="codicon codicon-add"></i>
          </button>
          <button 
            v-if="currentAgent" 
            class="action-btn" 
            @click="startRename"
            :title="t('components.settings.subagents.rename')"
          >
            <i class="codicon codicon-edit"></i>
          </button>
          <button 
            v-if="currentAgent" 
            class="action-btn danger" 
            @click="showDeleteConfirm = true; deleteAgentType = currentAgentType"
            :title="t('components.settings.subagents.delete')"
          >
            <i class="codicon codicon-trash"></i>
          </button>
        </div>
      </div>
      
      <!-- 代理配置表单 -->
      <div v-if="currentAgent" class="agent-config">
        <!-- 基本信息 -->
        <div class="config-section">
          <h5>{{ t('components.settings.subagents.basicInfo') }}</h5>
          
          <div class="form-group">
            <label>{{ t('components.settings.subagents.description') }}</label>
            <input
              type="text"
              :value="currentAgent.description"
              @change="updateAgentField('description', ($event.target as HTMLInputElement).value)"
              :placeholder="t('components.settings.subagents.descriptionPlaceholder')"
            />
          </div>
          
          <div class="form-row">
            <div class="form-group flex-1">
              <label>{{ t('components.settings.subagents.maxIterations') }}</label>
              <input
                type="number"
                :value="currentAgent.maxIterations ?? 20"
                min="-1"
                @change="updateAgentField('maxIterations', parseInt(($event.target as HTMLInputElement).value) || 20)"
              />
              <span class="field-hint">{{ t('components.settings.subagents.maxIterationsHint') }}</span>
            </div>
            
            <div class="form-group flex-1">
              <label>{{ t('components.settings.subagents.maxRuntime') }}</label>
              <input
                type="number"
                :value="currentAgent.maxRuntime ?? 300"
                min="-1"
                @change="updateAgentField('maxRuntime', parseInt(($event.target as HTMLInputElement).value) || 300)"
              />
              <span class="field-hint">{{ t('components.settings.subagents.maxRuntimeHint') }}</span>
            </div>
          </div>
          
          <div class="form-group">
            <label>{{ t('components.settings.subagents.failureMode.agentLabel') }}</label>
            <!--
              修改原因：单个 SubAgent 需要能覆盖全局默认失败恢复策略，且新建代理默认立刻让主工具失败。
              修改方式：把当前代理的 failureModeAfterRetries 作为显式字段保存；旧代理缺失时按 fail_parent_tool 显示但不因读取而写回。
              修改目的：兼容旧配置，并为后续 executor 状态机提供清晰的单代理策略输入。
            -->
            <CustomSelect
              :modelValue="currentAgent.failureModeAfterRetries || 'fail_parent_tool'"
              :options="failureModeOptions"
              @update:modelValue="updateAgentFailureMode"
            />
            <span class="field-hint">{{ t('components.settings.subagents.failureMode.agentHint') }}</span>
          </div>

          <div class="form-group">
            <CustomCheckbox
              :modelValue="currentAgent.enabled !== false"
              :label="t('components.settings.subagents.enabled')"
              @update:modelValue="updateAgentField('enabled', $event)"
            />
          </div>
        </div>
        
        <!-- 系统提示词 -->
        <div class="config-section">
          <h5>{{ t('components.settings.subagents.systemPrompt') }}</h5>
          <textarea
            class="system-prompt-textarea"
            :value="currentAgent.systemPrompt"
            @change="updateAgentField('systemPrompt', ($event.target as HTMLTextAreaElement).value)"
            :placeholder="t('components.settings.subagents.systemPromptPlaceholder')"
            rows="6"
          ></textarea>
        </div>
        
        <!-- 渠道和模型 -->
        <div class="config-section">
          <h5>{{ t('components.settings.subagents.channelModel') }}</h5>
          
          <div class="form-row">
            <div class="form-group flex-1">
              <label>{{ t('components.settings.subagents.channel') }}</label>
              <CustomSelect
                :modelValue="currentAgent.channel.channelId"
                :options="channelOptions"
                :placeholder="t('components.settings.subagents.selectChannel')"
                @update:modelValue="updateAgentField('channel', { ...currentAgent.channel, channelId: $event, modelId: '' })"
              />
            </div>
            
            <div class="form-group flex-1">
              <label>{{ t('components.settings.subagents.model') }}</label>
              <CustomSelect
                :modelValue="currentAgent.channel.modelId || ''"
                :options="modelOptions"
                :placeholder="t('components.settings.subagents.selectModel')"
                :disabled="!selectedChannel"
                @update:modelValue="updateAgentField('channel', { ...currentAgent.channel, modelId: $event })"
              />
            </div>
          </div>
        </div>
        
        <!-- 工具配置 -->
        <div class="config-section">
          <h5>{{ t('components.settings.subagents.tools') }}</h5>
          <p class="section-description">{{ t('components.settings.subagents.toolsDescription') }}</p>
          
          <!-- 工具模式选择 -->
          <div class="form-group">
            <label>{{ t('components.settings.subagents.toolMode.label') }}</label>
            <CustomSelect
              :modelValue="currentAgent.tools.mode"
              :options="toolModeOptions"
              @update:modelValue="updateAgentField('tools', { ...currentAgent.tools, mode: $event })"
            />
          </div>
          
          <!-- 工具列表（白名单/黑名单模式） -->
          <div 
            v-if="currentAgent.tools.mode === 'whitelist' || currentAgent.tools.mode === 'blacklist'" 
            class="tools-list"
          >
            <!-- 模式说明 -->
            <div class="tools-mode-hint">
              <i class="codicon codicon-info"></i>
              <span v-if="currentAgent.tools.mode === 'whitelist'">{{ t('components.settings.subagents.whitelistHint') }}</span>
              <span v-else>{{ t('components.settings.subagents.blacklistHint') }}</span>
            </div>
            
            <!-- 内置工具 -->
            <div v-if="builtinTools.length > 0" class="tool-category">
              <div class="category-header">
                <i class="codicon codicon-tools"></i>
                <span>{{ t('components.settings.subagents.builtinTools') }}</span>
                <span class="tool-count">{{ builtinTools.length }}</span>
              </div>
              <div class="tool-items">
                <div v-for="tool in builtinTools" :key="tool.name" class="tool-item">
                  <div class="tool-info">
                    <span class="tool-name">{{ tool.name }}</span>
                    <span v-if="tool.description" class="tool-description">{{ tool.description }}</span>
                  </div>
                  <CustomCheckbox
                    :modelValue="isToolSelected(tool.name)"
                    @update:modelValue="toggleTool(tool.name, $event)"
                  />
                </div>
              </div>
            </div>
            
            <!-- MCP 工具 -->
            <div v-if="mcpTools.length > 0" class="tool-category">
              <div class="category-header">
                <i class="codicon codicon-plug"></i>
                <span>{{ t('components.settings.subagents.mcpTools') }}</span>
                <span class="tool-count">{{ mcpTools.length }}</span>
              </div>
              <div class="tool-items">
                <div v-for="tool in mcpTools" :key="tool.name" class="tool-item">
                  <div class="tool-info">
                    <span class="tool-name">{{ tool.name }}</span>
                    <span v-if="tool.description" class="tool-description">{{ tool.description }}</span>
                  </div>
                  <CustomCheckbox
                    :modelValue="isToolSelected(tool.name)"
                    @update:modelValue="toggleTool(tool.name, $event)"
                  />
                </div>
              </div>
            </div>
            
            <!-- 空工具列表 -->
            <div v-if="allTools.length === 0" class="no-tools">
              <i class="codicon codicon-info"></i>
              <span>{{ t('components.settings.subagents.noTools') }}</span>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 空状态 -->
      <div v-else-if="!isLoading && subAgents.length === 0" class="empty-state">
        <i class="codicon codicon-hubot"></i>
        <p>{{ t('components.settings.subagents.emptyState') }}</p>
        <button class="primary-btn" @click="openCreateDialog">
          <i class="codicon codicon-add"></i>
          {{ t('components.settings.subagents.createFirst') }}
        </button>
      </div>
    </div>
    
    <!-- 新建对话框 -->
    <div v-if="showNewDialog" class="dialog-overlay" @click.self="showNewDialog = false">
      <div class="dialog">
        <div class="dialog-header">
          <h4>{{ t('components.settings.subagents.createDialog.title') }}</h4>
          <button class="close-btn" @click="showNewDialog = false">
            <i class="codicon codicon-close"></i>
          </button>
        </div>
        
        <div class="dialog-body">
          <div class="form-group">
            <label>{{ t('components.settings.subagents.createDialog.nameLabel') }}</label>
            <input
              v-model="newAgentName"
              type="text"
              :placeholder="t('components.settings.subagents.createDialog.namePlaceholder')"
              @keyup.enter="createAgent"
            />
          </div>
          
          <div v-if="createError" class="error-message">
            {{ createError }}
          </div>
        </div>
        
        <div class="dialog-footer">
          <button class="secondary-btn" @click="showNewDialog = false">
            {{ t('common.cancel') }}
          </button>
          <button class="primary-btn" @click="createAgent" :disabled="isCreating">
            <i v-if="isCreating" class="codicon codicon-loading codicon-modifier-spin"></i>
            {{ t('common.create') }}
          </button>
        </div>
      </div>
    </div>
    
    <!-- 重命名对话框 -->
    <div v-if="isEditing" class="dialog-overlay" @click.self="cancelRename">
      <div class="dialog">
        <div class="dialog-header">
          <h4>{{ t('components.settings.subagents.rename') }}</h4>
          <button class="close-btn" @click="cancelRename">
            <i class="codicon codicon-close"></i>
          </button>
        </div>
        
        <div class="dialog-body">
          <div class="form-group">
            <label>{{ t('components.settings.subagents.createDialog.nameLabel') }}</label>
            <input
              v-model="editingName"
              type="text"
              @keyup.enter="saveRename"
            />
          </div>
          
          <div v-if="renameError" class="error-message">
            {{ renameError }}
          </div>
        </div>
        
        <div class="dialog-footer">
          <button class="secondary-btn" @click="cancelRename">
            {{ t('common.cancel') }}
          </button>
          <button class="primary-btn" @click="saveRename">
            {{ t('common.save') }}
          </button>
        </div>
      </div>
    </div>
    
    <!-- 确认删除对话框 -->
    <ConfirmDialog
      v-model="showDeleteConfirm"
      :title="t('components.settings.subagents.deleteConfirm.title')"
      :message="t('components.settings.subagents.deleteConfirm.message')"
      :confirmText="t('common.delete')"
      :cancelText="t('common.cancel')"
      :isDanger="true"
      @confirm="deleteAgent"
    />
  </div>
</template>

<style scoped>
.subagents-settings {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px;
  color: var(--vscode-descriptionForeground);
}

.settings-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 子代理选择器 */
.agent-selector {
  display: flex;
  gap: 8px;
  align-items: center;
}

.agent-selector :deep(.custom-select) {
  flex: 1;
}

.no-agents {
  flex: 1;
  padding: 8px 12px;
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border);
  border-radius: 4px;
  color: var(--vscode-descriptionForeground);
}

.agent-actions {
  display: flex;
  gap: 4px;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 4px;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  cursor: pointer;
  transition: background 0.15s;
}

.action-btn:hover {
  background: var(--vscode-button-secondaryHoverBackground);
}

.action-btn.danger:hover {
  background: var(--vscode-errorForeground);
  color: var(--vscode-editor-background);
}

/* 配置区块 */
.agent-config {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.config-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.config-section h5 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--vscode-foreground);
}

.section-description {
  margin: 0;
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

/* 表单 */
.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  font-size: 12px;
  color: var(--vscode-foreground);
}

.form-group input,
.form-group textarea {
  padding: 6px 10px;
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border);
  border-radius: 4px;
  color: var(--vscode-input-foreground);
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
}

.form-group input:focus,
.form-group textarea:focus {
  outline: none;
  border-color: var(--vscode-focusBorder);
}

.field-hint {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  margin-top: 2px;
}

/* 全局配置区域 */
.global-config {
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--vscode-panel-border);
}

/* 数字输入框隐藏上下箭头 */
input[type="number"] {
  appearance: textfield;
  -moz-appearance: textfield;
}

input[type="number"]::-webkit-outer-spin-button,
input[type="number"]::-webkit-inner-spin-button {
  appearance: none;
  -webkit-appearance: none;
  margin: 0;
}

.global-config input[type="number"] {
  width: 100px;
}

/* Agent 配置中的数字输入框 */
.agent-config input[type="number"] {
  width: 120px;
}

/* 系统提示词编辑框 */
.system-prompt-textarea {
  width: 100%;
  min-height: 120px;
  padding: 12px;
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border);
  border-radius: 6px;
  color: var(--vscode-input-foreground);
  font-size: 13px;
  font-family: var(--vscode-editor-font-family), monospace;
  line-height: 1.5;
  resize: vertical;
  box-sizing: border-box;
}

.system-prompt-textarea::placeholder {
  color: var(--vscode-input-placeholderForeground);
}

.system-prompt-textarea:focus {
  outline: none;
  border-color: var(--vscode-focusBorder);
  box-shadow: 0 0 0 1px var(--vscode-focusBorder);
}

.form-row {
  display: flex;
  gap: 12px;
}

.flex-1 {
  flex: 1;
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 48px 24px;
  text-align: center;
}

.empty-state i {
  font-size: 48px;
  color: var(--vscode-descriptionForeground);
  opacity: 0.5;
}

.empty-state p {
  margin: 0;
  color: var(--vscode-descriptionForeground);
}

.primary-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
}

.primary-btn:hover {
  background: var(--vscode-button-hoverBackground);
}

.primary-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.secondary-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border: none;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
}

.secondary-btn:hover {
  background: var(--vscode-button-secondaryHoverBackground);
}

/* 对话框 */
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
  border: 1px solid var(--vscode-widget-border);
  border-radius: 8px;
  min-width: 400px;
  max-width: 500px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid var(--vscode-widget-border);
}

.dialog-header h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: transparent;
  border: none;
  color: var(--vscode-foreground);
  cursor: pointer;
  border-radius: 4px;
}

.close-btn:hover {
  background: var(--vscode-toolbar-hoverBackground);
}

.dialog-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px;
  border-top: 1px solid var(--vscode-widget-border);
}

.hint {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.error-message {
  padding: 8px 12px;
  background: var(--vscode-inputValidation-errorBackground);
  border: 1px solid var(--vscode-inputValidation-errorBorder);
  border-radius: 4px;
  color: var(--vscode-errorForeground);
  font-size: 12px;
}

/* 工具列表 */
.tools-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 12px;
  padding: 12px;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-widget-border);
  border-radius: 6px;
}

.tools-mode-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--vscode-textBlockQuote-background);
  border-left: 3px solid var(--vscode-textLink-foreground);
  border-radius: 0 4px 4px 0;
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

.tools-mode-hint i {
  color: var(--vscode-textLink-foreground);
}

.tool-category {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.category-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--vscode-foreground);
  border-bottom: 1px solid var(--vscode-widget-border);
}

.category-header i {
  font-size: 14px;
  color: var(--vscode-descriptionForeground);
}

.tool-count {
  margin-left: auto;
  padding: 2px 6px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  border-radius: 10px;
  font-size: 11px;
  font-weight: normal;
}

.tool-items {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tool-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 4px;
  transition: background 0.15s;
}

.tool-item:hover {
  background: var(--vscode-list-hoverBackground);
}

.tool-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.tool-name {
  font-size: 13px;
  color: var(--vscode-foreground);
  font-family: var(--vscode-editor-font-family), monospace;
}

.tool-description {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.no-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}
</style>
