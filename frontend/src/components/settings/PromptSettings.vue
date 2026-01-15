<script setup lang="ts">
import { ref, reactive, onMounted, computed, watch } from 'vue'
import { sendToExtension } from '@/utils/vscode'
import { useI18n } from '@/i18n'

const { t } = useI18n()

// 渠道类型
type ChannelType = 'gemini' | 'openai' | 'anthropic'

// 提示词模块定义
interface PromptModule {
  id: string
  name: string
  description: string
  example?: string
  requiresConfig?: string
}

// 系统提示词配置（功能始终启用，不可关闭）
interface SystemPromptConfig {
  template: string           // 静态系统提示词模板
  dynamicTemplateEnabled: boolean  // 是否启用动态上下文模板
  dynamicTemplate: string    // 动态上下文模板
  customPrefix: string
  customSuffix: string
}

// 静态变量（放入系统提示词，可被 API provider 缓存）
const STATIC_PROMPT_MODULES: PromptModule[] = [
  {
    id: 'ENVIRONMENT',
    name: '环境信息',
    description: '包含工作区路径、操作系统、时区和用户语言（静态内容，可缓存）',
    example: `====

ENVIRONMENT

Current Workspace: /path/to/project
Operating System: Windows 11
Timezone: Asia/Shanghai
User Language: zh-CN
Please respond using the user's language by default.`
  },
  {
    id: 'TOOLS',
    name: '工具定义',
    description: '根据渠道配置生成 XML 或 Function Call 格式的工具定义（此变量由系统自动填充）',
    example: `====

TOOLS

You have access to these tools:

## read_file
Description: Read file content
...`
  },
  {
    id: 'MCP_TOOLS',
    name: 'MCP 工具',
    description: '来自 MCP 服务器的额外工具定义（此变量由系统自动填充）',
    example: `====

MCP TOOLS

Additional tools from MCP servers:
...`,
    requiresConfig: 'MCP 设置中需要配置并连接服务器'
  }
]

// 动态变量（作为上下文消息临时插入，不存储到历史记录）
const DYNAMIC_CONTEXT_MODULES: PromptModule[] = [
  {
    id: 'WORKSPACE_FILES',
    name: '工作区文件树',
    description: '列出工作区中的文件和目录结构，受上下文感知设置中的深度和忽略模式影响',
    example: `====

WORKSPACE FILES

The following is a list of files in the current workspace:

src/
  main.ts
  utils/
    helper.ts`,
    requiresConfig: '上下文感知 > 发送工作区文件树'
  },
  {
    id: 'OPEN_TABS',
    name: '打开的标签页',
    description: '列出当前在编辑器中打开的文件标签页',
    example: `====

OPEN TABS

Currently open files in editor:
  - src/main.ts
  - src/utils/helper.ts`,
    requiresConfig: '上下文感知 > 发送打开的标签页'
  },
  {
    id: 'ACTIVE_EDITOR',
    name: '活动编辑器',
    description: '显示当前正在编辑的文件路径',
    example: `====

ACTIVE EDITOR

Currently active file: src/main.ts`,
    requiresConfig: '上下文感知 > 发送当前活动编辑器'
  },
  {
    id: 'DIAGNOSTICS',
    name: '诊断信息',
    description: '显示工作区的错误、警告等诊断信息，帮助 AI 修复代码问题',
    example: `====

DIAGNOSTICS

The following diagnostics were found in the workspace:

src/main.ts:
  Line 10: [Error] Cannot find name 'foo'. (ts)
  Line 15: [Warning] 'bar' is defined but never used. (ts)`,
    requiresConfig: '上下文感知 > 启用诊断信息'
  },
  {
    id: 'PINNED_FILES',
    name: '固定文件内容',
    description: '显示用户固定的文件的完整内容',
    example: `====

PINNED FILES CONTENT

The following are pinned files...

--- README.md ---
# Project Title
...`,
    requiresConfig: '需要在输入框旁的固定文件按钮中添加文件'
  },
  {
    id: 'SKILLS',
    name: 'Skills 内容',
    description: '显示当前启用的 Skills 的内容。Skills 是用户自定义的知识模块，AI 可以通过 toggle_skills 工具动态启用/禁用。',
    example: `====

ACTIVE SKILLS

The following skills are currently active...

## pymatgen

# Pymatgen - Python Materials Genomics
...`,
    requiresConfig: 'AI 通过 toggle_skills 工具启用 skills'
  }
]

// 静态变量 ID 集合
const staticModuleIds = new Set(STATIC_PROMPT_MODULES.map(m => m.id))

// 动态变量 ID 集合
const dynamicModuleIds = new Set(DYNAMIC_CONTEXT_MODULES.map(m => m.id))

// 默认静态系统提示词模板
const DEFAULT_TEMPLATE = `You are a professional programming assistant, proficient in multiple programming languages and frameworks.

{{$ENVIRONMENT}}

{{$TOOLS}}

{{$MCP_TOOLS}}

====

GUIDELINES

- Use the provided tools to complete tasks. Tools can help you read files, search code, execute commands, and modify files.
- **IMPORTANT: Avoid duplicate tool calls.** Each tool should only be called once with the same parameters. Never repeat the same tool call multiple times.
- When you need to understand the codebase, use read_file to examine specific files or search_in_files to find relevant code patterns.
- When you need to make changes, use apply_diff for targeted modifications or write_to_file for creating new files.
- If the task is simple and doesn't require tools, just respond directly without calling any tools.
- Always maintain code readability and maintainability.
- Do not omit any code.`

// 默认动态上下文模板
const DEFAULT_DYNAMIC_TEMPLATE = `This is the current global variable information you can use. Continue with the previous task if the information is not needed and ingore it.

{{$WORKSPACE_FILES}}

{{$OPEN_TABS}}

{{$ACTIVE_EDITOR}}

{{$DIAGNOSTICS}}

{{$PINNED_FILES}}

{{$SKILLS}}`

// 配置状态
const config = reactive<SystemPromptConfig>({
  template: DEFAULT_TEMPLATE,
  dynamicTemplateEnabled: true,
  dynamicTemplate: DEFAULT_DYNAMIC_TEMPLATE,
  customPrefix: '',
  customSuffix: ''
})

// 原始配置（用于检测变化）
const originalConfig = ref<SystemPromptConfig | null>(null)

// 是否有未保存的变化
const hasChanges = computed(() => {
  if (!originalConfig.value) return false
  return config.template !== originalConfig.value.template ||
         config.dynamicTemplateEnabled !== originalConfig.value.dynamicTemplateEnabled ||
         config.dynamicTemplate !== originalConfig.value.dynamicTemplate ||
         config.customPrefix !== originalConfig.value.customPrefix ||
         config.customSuffix !== originalConfig.value.customSuffix
})

// 加载状态
const isLoading = ref(true)
const isSaving = ref(false)
const saveMessage = ref('')

// Token 计数状态
const staticTokenCount = ref<number | null>(null)
const dynamicTokenCount = ref<number | null>(null)
const isCountingTokens = ref(false)
const tokenCountError = ref('')
const selectedChannel = ref<ChannelType>('gemini')

// 可用的渠道选项
const channelOptions: { value: ChannelType; label: string }[] = [
  { value: 'gemini', label: 'Gemini' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' }
]

// 展开的模块
const expandedModule = ref<string | null>(null)

// 加载配置
async function loadConfig() {
  isLoading.value = true
  try {
    const result = await sendToExtension<SystemPromptConfig>('getSystemPromptConfig', {})
    if (result) {
      config.template = result.template || DEFAULT_TEMPLATE
      config.dynamicTemplateEnabled = result.dynamicTemplateEnabled ?? true
      config.dynamicTemplate = result.dynamicTemplate || DEFAULT_DYNAMIC_TEMPLATE
      config.customPrefix = result.customPrefix || ''
      config.customSuffix = result.customSuffix || ''
      originalConfig.value = { ...config }
    }
  } catch (error) {
    console.error('Failed to load system prompt config:', error)
  } finally {
    isLoading.value = false
  }
}

// 保存配置
async function saveConfig() {
  isSaving.value = true
  saveMessage.value = ''
  try {
    // 保存前清理多余空行
    const cleanedTemplate = cleanupEmptyLines(config.template)
    const cleanedDynamicTemplate = cleanupEmptyLines(config.dynamicTemplate)
    
    await sendToExtension('updateSystemPromptConfig', {
      config: {
        template: cleanedTemplate,
        dynamicTemplateEnabled: config.dynamicTemplateEnabled,
        dynamicTemplate: cleanedDynamicTemplate,
        customPrefix: config.customPrefix,
        customSuffix: config.customSuffix
      }
    })
    
    // 更新本地配置为清理后的版本
    config.template = cleanedTemplate
    config.dynamicTemplate = cleanedDynamicTemplate
    originalConfig.value = { ...config }
    saveMessage.value = t('components.settings.promptSettings.saveSuccess')
    setTimeout(() => { saveMessage.value = '' }, 2000)
    
    // 保存成功后自动更新 token 计数
    await countTokens()
  } catch (error) {
    console.error('Failed to save system prompt config:', error)
    saveMessage.value = t('components.settings.promptSettings.saveFailed')
  } finally{
    isSaving.value = false
  }
}

// 计算 token 数量（分别计算静态模板和动态上下文）
async function countTokens() {
  if (!config.template) {
    staticTokenCount.value = null
    dynamicTokenCount.value = null
    return
  }
  
  isCountingTokens.value = true
  tokenCountError.value = ''
  
  try {
    const result = await sendToExtension<{
      success: boolean
      staticTokens?: number
      dynamicTokens?: number
      error?: string
    }>('countSystemPromptTokens', {
      staticText: config.template,
      channelType: selectedChannel.value
    })
    
    if (result?.success) {
      staticTokenCount.value = result.staticTokens ?? null
      dynamicTokenCount.value = result.dynamicTokens ?? null
    } else {
      staticTokenCount.value = null
      dynamicTokenCount.value = null
      tokenCountError.value = result?.error || 'Token count failed'
    }
  } catch (error: any) {
    console.error('Failed to count tokens:', error)
    staticTokenCount.value = null
    dynamicTokenCount.value = null
    tokenCountError.value = error.message || 'Token count failed'
  } finally {
    isCountingTokens.value = false
  }
}

// 格式化 token 数量显示
function formatTokenCount(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`
  }
  return count.toString()
}

// 清理文本中的多余空行（将3个或以上连续换行压缩为2个）
function cleanupEmptyLines(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

// 重置静态模板为默认
function resetStaticToDefault() {
  config.template = DEFAULT_TEMPLATE
}

// 重置动态模板为默认
function resetDynamicToDefault() {
  config.dynamicTemplate = DEFAULT_DYNAMIC_TEMPLATE
}

// 插入变量到静态模板
function insertStaticModule(moduleId: string) {
  if (!staticModuleIds.has(moduleId)) {
    console.warn(`Invalid static module ID: ${moduleId}`)
    return
  }
  const placeholder = `{{$${moduleId}}}`
  config.template += placeholder
}

// 插入变量到动态模板
function insertDynamicModule(moduleId: string) {
  if (!dynamicModuleIds.has(moduleId)) {
    console.warn(`Invalid dynamic module ID: ${moduleId}`)
    return
  }
  const placeholder = `{{$${moduleId}}}`
  config.dynamicTemplate += placeholder
}

// 切换模块展开
function toggleModule(moduleId: string) {
  expandedModule.value = expandedModule.value === moduleId ? null : moduleId
}

// 生成变量ID显示字符串（使用 {{$xxx}} 格式）
function formatModuleId(id: string): string {
  return `\{\{$${id}\}\}`
}

// 初始化
onMounted(async () => {
  await loadConfig()
  // 加载配置后自动计算 token 数量
  await countTokens()
})

// 监听渠道变化，重新计算 token
watch(selectedChannel, () => {
  countTokens()
})
</script>

<template>
  <div class="prompt-settings">
    <!-- 加载中 -->
    <div v-if="isLoading" class="loading-state">
      <i class="codicon codicon-loading codicon-modifier-spin"></i>
      <span>{{ t('components.settings.promptSettings.loading') }}</span>
    </div>
    
    <template v-else>
      <!-- 静态系统提示词编辑区 -->
      <div class="template-section">
        <div class="section-header">
          <label class="section-label">
            <i class="codicon codicon-file-code"></i>
            {{ t('components.settings.promptSettings.staticSection.title') }}
            <span class="section-badge cacheable">{{ t('components.settings.promptSettings.staticModules.badge') }}</span>
          </label>
          <button class="reset-btn" @click="resetStaticToDefault">
            <i class="codicon codicon-discard"></i>
            {{ t('components.settings.promptSettings.templateSection.resetButton') }}
          </button>
        </div>
        
        <p class="section-description">
          {{ t('components.settings.promptSettings.staticSection.description') }}
        </p>
        
        <textarea
          v-model="config.template"
          class="template-textarea"
          :placeholder="t('components.settings.promptSettings.staticSection.placeholder')"
          rows="12"
        ></textarea>
      </div>
      
      <!-- 动态上下文模板编辑区 -->
      <div class="template-section dynamic-section">
        <div class="section-header">
          <label class="section-label">
            <i class="codicon codicon-sync"></i>
            {{ t('components.settings.promptSettings.dynamicSection.title') }}
            <span class="section-badge realtime">{{ t('components.settings.promptSettings.dynamicModules.badge') }}</span>
          </label>
          <div class="section-header-actions">
            <!-- 启用开关 -->
            <label class="toggle-switch" :title="t('components.settings.promptSettings.dynamicSection.enableTooltip')">
              <input 
                type="checkbox" 
                v-model="config.dynamicTemplateEnabled"
              />
              <span class="toggle-slider"></span>
            </label>
            <button class="reset-btn" @click="resetDynamicToDefault" :disabled="!config.dynamicTemplateEnabled">
              <i class="codicon codicon-discard"></i>
              {{ t('components.settings.promptSettings.templateSection.resetButton') }}
            </button>
          </div>
        </div>
        
        <p class="section-description">
          {{ t('components.settings.promptSettings.dynamicSection.description') }}
        </p>
        
        <!-- 禁用时显示提示 -->
        <div v-if="!config.dynamicTemplateEnabled" class="disabled-notice">
          <i class="codicon codicon-info"></i>
          <span>{{ t('components.settings.promptSettings.dynamicSection.disabledNotice') }}</span>
        </div>
        
        <textarea
          v-else
          v-model="config.dynamicTemplate"
          class="template-textarea"
          :placeholder="t('components.settings.promptSettings.dynamicSection.placeholder')"
          rows="10"
        ></textarea>
      </div>
      
      <!-- 保存按钮和 Token 计数 -->
      <div class="save-section">
        <div class="save-row">
          <button
            class="save-btn"
            @click="saveConfig"
            :disabled="isSaving || !hasChanges"
          >
            <i v-if="isSaving" class="codicon codicon-loading codicon-modifier-spin"></i>
            <span v-else>{{ t('components.settings.promptSettings.saveButton') }}</span>
          </button>
          <span v-if="saveMessage" class="save-message" :class="{ success: saveMessage === t('components.settings.promptSettings.saveSuccess') }">
            {{ saveMessage }}
          </span>
        </div>
        
        <!-- Token 计数显示 -->
        <div class="token-count-section">
          <div class="token-count-header">
            <label class="token-label">
              <i class="codicon codicon-symbol-numeric"></i>
              {{ t('components.settings.promptSettings.tokenCount.label') }}
            </label>
            
            <select
              v-model="selectedChannel"
              class="channel-select"
              :title="t('components.settings.promptSettings.tokenCount.channelTooltip')"
            >
              <option v-for="opt in channelOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
            
            <button
              class="refresh-btn"
              @click="countTokens"
              :disabled="isCountingTokens"
              :title="t('components.settings.promptSettings.tokenCount.refreshTooltip')"
            >
              <i :class="['codicon', isCountingTokens ? 'codicon-loading codicon-modifier-spin' : 'codicon-refresh']"></i>
            </button>
          </div>
          
          <!-- 分别显示静态和动态 token 数 -->
          <div class="token-count-details">
            <!-- 静态模板 token -->
            <div class="token-count-item">
              <span 
                class="token-item-label static-label" 
                :title="t('components.settings.promptSettings.tokenCount.staticTooltip')"
              >
                <i class="codicon codicon-lock"></i>
                {{ t('components.settings.promptSettings.tokenCount.staticLabel') }}
              </span>
              <div class="token-value">
                <template v-if="isCountingTokens">
                  <i class="codicon codicon-loading codicon-modifier-spin"></i>
                </template>
                <template v-else-if="staticTokenCount !== null">
                  <span class="token-number static">{{ formatTokenCount(staticTokenCount) }}</span>
                  <span class="token-unit">tokens</span>
                </template>
                <template v-else-if="tokenCountError">
                  <span class="token-error" :title="tokenCountError">
                    <i class="codicon codicon-warning"></i>
                    {{ t('components.settings.promptSettings.tokenCount.failed') }}
                  </span>
                </template>
                <template v-else>
                  <span class="token-na">--</span>
                </template>
              </div>
            </div>
            
            <!-- 动态上下文 token -->
            <div class="token-count-item">
              <span 
                class="token-item-label dynamic-label" 
                :title="t('components.settings.promptSettings.tokenCount.dynamicTooltip')"
              >
                <i class="codicon codicon-sync"></i>
                {{ t('components.settings.promptSettings.tokenCount.dynamicLabel') }}
              </span>
              <div class="token-value">
                <template v-if="isCountingTokens">
                  <i class="codicon codicon-loading codicon-modifier-spin"></i>
                </template>
                <template v-else-if="dynamicTokenCount !== null">
                  <span class="token-number dynamic">{{ formatTokenCount(dynamicTokenCount) }}</span>
                  <span class="token-unit">tokens</span>
                </template>
                <template v-else-if="tokenCountError">
                  <span class="token-error" :title="tokenCountError">
                    <i class="codicon codicon-warning"></i>
                    {{ t('components.settings.promptSettings.tokenCount.failed') }}
                  </span>
                </template>
                <template v-else>
                  <span class="token-na">--</span>
                </template>
              </div>
            </div>
          </div>
          
          <p class="token-hint">
            {{ t('components.settings.promptSettings.tokenCount.hint') }}
          </p>
        </div>
      </div>
      
      <!-- 可用变量参考 -->
      <div class="modules-reference">
        <h5 class="reference-title">
          <i class="codicon codicon-references"></i>
          {{ t('components.settings.promptSettings.modulesReference.title') }}
        </h5>
        
        <!-- 静态变量组 -->
        <div class="modules-group">
          <div class="group-header">
            <i class="codicon codicon-lock"></i>
            <span class="group-title">{{ t('components.settings.promptSettings.staticModules.title') }}</span>
            <span class="group-badge static-badge">{{ t('components.settings.promptSettings.staticModules.badge') }}</span>
          </div>
          <p class="group-description">{{ t('components.settings.promptSettings.staticModules.description') }}</p>
          
          <div class="modules-list">
            <div
              v-for="module in STATIC_PROMPT_MODULES"
              :key="module.id"
              class="module-item"
              :class="{ expanded: expandedModule === module.id }"
            >
              <div class="module-header" @click="toggleModule(module.id)">
                <div class="module-info">
                  <code class="module-id">{{ formatModuleId(module.id) }}</code>
                  <span class="module-name">{{ t(`components.settings.promptSettings.modules.${module.id}.name`) }}</span>
                </div>
                <button
                  class="insert-btn"
                  @click.stop="insertStaticModule(module.id)"
                  :title="t('components.settings.promptSettings.modulesReference.insertTooltip')"
                >
                  <i class="codicon codicon-add"></i>
                </button>
              </div>
              
              <div v-if="expandedModule === module.id" class="module-details">
                <p class="module-description">{{ t(`components.settings.promptSettings.modules.${module.id}.description`) }}</p>
                
                <div v-if="module.requiresConfig" class="module-requires">
                  <i class="codicon codicon-info"></i>
                  <span>{{ t('components.settings.promptSettings.requiresConfigLabel') }} {{ t(`components.settings.promptSettings.modules.${module.id}.requiresConfig`) }}</span>
                </div>
                
                <div v-if="module.example" class="module-example">
                  <label>{{ t('components.settings.promptSettings.exampleOutput') }}</label>
                  <pre>{{ module.example }}</pre>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <!-- 动态变量组 -->
        <div class="modules-group">
          <div class="group-header">
            <i class="codicon codicon-sync"></i>
            <span class="group-title">{{ t('components.settings.promptSettings.dynamicModules.title') }}</span>
            <span class="group-badge dynamic-badge">{{ t('components.settings.promptSettings.dynamicModules.badge') }}</span>
          </div>
          <p class="group-description">{{ t('components.settings.promptSettings.dynamicModules.description') }}</p>
          
          <div class="modules-list">
            <div
              v-for="module in DYNAMIC_CONTEXT_MODULES"
              :key="module.id"
              class="module-item"
              :class="{ expanded: expandedModule === module.id }"
            >
              <div class="module-header" @click="toggleModule(module.id)">
                <div class="module-info">
                  <code class="module-id">{{ formatModuleId(module.id) }}</code>
                  <span class="module-name">{{ t(`components.settings.promptSettings.modules.${module.id}.name`) }}</span>
                </div>
                <button
                  class="insert-btn"
                  @click.stop="insertDynamicModule(module.id)"
                  :title="t('components.settings.promptSettings.modulesReference.insertTooltip')"
                >
                  <i class="codicon codicon-add"></i>
                </button>
              </div>
              
              <div v-if="expandedModule === module.id" class="module-details">
                <p class="module-description">{{ t(`components.settings.promptSettings.modules.${module.id}.description`) }}</p>
                
                <div v-if="module.requiresConfig" class="module-requires">
                  <i class="codicon codicon-info"></i>
                  <span>{{ t('components.settings.promptSettings.requiresConfigLabel') }} {{ t(`components.settings.promptSettings.modules.${module.id}.requiresConfig`) }}</span>
                </div>
                
                <div v-if="module.example" class="module-example">
                  <label>{{ t('components.settings.promptSettings.exampleOutput') }}</label>
                  <pre>{{ module.example }}</pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.prompt-settings {
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

.template-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
}

.template-section.dynamic-section {
  border-color: var(--vscode-charts-blue);
  border-style: dashed;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.section-header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.section-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
}

.section-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 10px;
  font-weight: 500;
}

.section-badge.cacheable {
  background: var(--vscode-charts-green);
  color: var(--vscode-editor-background);
}

.section-badge.realtime {
  background: var(--vscode-charts-blue);
  color: var(--vscode-editor-background);
}

.section-label code {
  font-size: 11px;
  padding: 2px 4px;
  background: var(--vscode-textCodeBlock-background);
  border-radius: 3px;
  color: var(--vscode-textPreformat-foreground);
}

.section-description {
  margin: 0;
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

.section-description code {
  font-size: 11px;
  padding: 1px 4px;
  background: var(--vscode-textCodeBlock-background);
  border-radius: 3px;
}

.reset-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  font-size: 11px;
  background: transparent;
  color: var(--vscode-foreground);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.15s;
}

.reset-btn:hover:not(:disabled) {
  background: var(--vscode-list-hoverBackground);
}

.reset-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.template-textarea,
.custom-textarea {
  width: 100%;
  padding: 8px 10px;
  font-size: 12px;
  font-family: var(--vscode-editor-font-family), monospace;
  line-height: 1.5;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border);
  border-radius: 4px;
  resize: vertical;
  outline: none;
}

.template-textarea:focus,
.custom-textarea:focus {
  border-color: var(--vscode-focusBorder);
}

.template-textarea:disabled,
.custom-textarea:disabled {
  opacity: 0.6;
}

.save-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 8px;
}

.save-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.save-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 80px;
  padding: 8px 16px;
  font-size: 13px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.15s;
}

.save-btn:hover:not(:disabled) {
  background: var(--vscode-button-hoverBackground);
}

.save-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.save-message {
  font-size: 12px;
  color: var(--vscode-errorForeground);
}

.save-message.success {
  color: var(--vscode-terminal-ansiGreen);
}

/* Token 计数区域 */
.token-count-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
}

.token-count-header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.token-count-details {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.token-count-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--vscode-sideBar-background);
  border-radius: 4px;
  min-width: 150px;
}

.token-item-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  cursor: help;
}

.token-item-label.static-label .codicon {
  color: var(--vscode-charts-green);
}

.token-item-label.dynamic-label .codicon {
  color: var(--vscode-charts-blue);
}

.token-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--vscode-foreground);
}

.channel-select {
  padding: 4px 8px;
  font-size: 11px;
  background: var(--vscode-dropdown-background);
  color: var(--vscode-dropdown-foreground);
  border: 1px solid var(--vscode-dropdown-border);
  border-radius: 4px;
  outline: none;
  cursor: pointer;
}

.channel-select:focus {
  border-color: var(--vscode-focusBorder);
}

.refresh-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  background: transparent;
  color: var(--vscode-foreground);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.15s;
}

.refresh-btn:hover:not(:disabled) {
  background: var(--vscode-list-hoverBackground);
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.token-value {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}

.token-count-header .token-value {
  margin-left: auto;
}

.token-number {
  font-weight: 600;
}

.token-number.static {
  color: var(--vscode-charts-green);
}

.token-number.dynamic {
  color: var(--vscode-charts-blue);
}

.token-unit {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.token-error {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--vscode-errorForeground);
  cursor: help;
}

.token-na {
  color: var(--vscode-descriptionForeground);
}

.token-hint {
  margin: 0;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

/* 模块参考 */
.modules-reference {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--vscode-panel-border);
}

.reference-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 12px 0;
  font-size: 13px;
  font-weight: 500;
}

.modules-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.module-item {
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  overflow: hidden;
}

.module-item.expanded {
  border-color: var(--vscode-focusBorder);
}

.module-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  cursor: pointer;
  transition: background-color 0.15s;
}

.module-header:hover {
  background: var(--vscode-list-hoverBackground);
}

.module-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.module-id {
  font-size: 11px;
  padding: 2px 6px;
  background: var(--vscode-textCodeBlock-background);
  border-radius: 3px;
  color: var(--vscode-textPreformat-foreground);
}

.module-name {
  font-size: 12px;
  color: var(--vscode-foreground);
}

.insert-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  background: transparent;
  color: var(--vscode-foreground);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.15s;
}

.insert-btn:hover:not(:disabled) {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border-color: var(--vscode-button-background);
}

.insert-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.module-details {
  padding: 10px 12px;
  background: var(--vscode-sideBar-background);
  border-top: 1px solid var(--vscode-panel-border);
}

.module-description {
  margin: 0 0 8px 0;
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

.module-requires {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 11px;
  color: var(--vscode-notificationsInfoIcon-foreground);
}

.module-example {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.module-example label {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.module-example pre {
  margin: 0;
  padding: 8px;
  font-size: 11px;
  font-family: var(--vscode-editor-font-family), monospace;
  line-height: 1.4;
  background: var(--vscode-textCodeBlock-background);
  border-radius: 4px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

/* Loading 动画 */
.codicon-modifier-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* 变量分组样式 */
.modules-group {
  margin-bottom: 16px;
  padding: 12px;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
}

.modules-group:last-child {
  margin-bottom: 0;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.group-header .codicon {
  font-size: 14px;
  color: var(--vscode-foreground);
}

.group-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--vscode-foreground);
}

.group-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 10px;
  font-weight: 500;
}

.static-badge {
  background: var(--vscode-charts-green);
  color: var(--vscode-editor-background);
}

.dynamic-badge {
  background: var(--vscode-charts-blue);
  color: var(--vscode-editor-background);
}

.group-description {
  margin: 0 0 12px 0;
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  line-height: 1.5;
}

/* 开关样式 */
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
  cursor: pointer;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border);
  border-radius: 10px;
  transition: 0.2s;
}

.toggle-slider::before {
  position: absolute;
  content: "";
  height: 14px;
  width: 14px;
  left: 2px;
  bottom: 2px;
  background-color: var(--vscode-foreground);
  border-radius: 50%;
  transition: 0.2s;
}

.toggle-switch input:checked + .toggle-slider {
  background-color: var(--vscode-button-background);
  border-color: var(--vscode-button-background);
}

.toggle-switch input:checked + .toggle-slider::before {
  transform: translateX(16px);
  background-color: var(--vscode-button-foreground);
}

.toggle-switch input:focus + .toggle-slider {
  border-color: var(--vscode-focusBorder);
}

/* 禁用提示 */
.disabled-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: var(--vscode-inputValidation-infoBackground);
  border: 1px solid var(--vscode-inputValidation-infoBorder);
  border-radius: 4px;
  font-size: 12px;
  color: var(--vscode-foreground);
}

.disabled-notice .codicon {
  color: var(--vscode-notificationsInfoIcon-foreground);
}
</style>