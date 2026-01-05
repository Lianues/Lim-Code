<script setup lang="ts">
import { ref, reactive, onMounted, toRaw } from 'vue'
import { CustomCheckbox } from '../common'
import { sendToExtension } from '@/utils/vscode'
import { useI18n } from '@/i18n'

const { t } = useI18n()

// Token 计数配置接口
interface TokenCountChannelConfig {
    enabled: boolean
    baseUrl: string
    apiKey: string
    model: string
}

interface TokenCountConfig {
    gemini?: TokenCountChannelConfig
    openai?: TokenCountChannelConfig
    anthropic?: TokenCountChannelConfig
    'openai-responses'?: TokenCountChannelConfig
}

// 加载状态
const isLoading = ref(true)
const isSaving = ref(false)
const saveMessage = ref('')
const saveMessageType = ref<'success' | 'error'>('success')

// 配置数据
const config = reactive<TokenCountConfig>({
    gemini: {
        enabled: false,
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:countTokens?key={key}',
        apiKey: '',
        model: 'gemini-2.5-pro'
    },
    openai: {
        enabled: false,
        baseUrl: 'https://api.openai.com/v1/chat/completions',
        apiKey: '',
        model: 'gpt-5'
    },
    anthropic: {
        enabled: false,
        baseUrl: 'https://api.anthropic.com/v1/messages/count_tokens',
        apiKey: '',
        model: 'claude-sonnet-4-5'
    },
    'openai-responses': {
        enabled: false,
        baseUrl: 'https://api.openai.com/v1/responses/input_tokens',
        apiKey: '',
        model: 'gpt-5'
    }
})

// API Key 可见性
const showApiKey = reactive({
    gemini: false,
    openai: false,
    anthropic: false,
    'openai-responses': false
})

// 当前展开的面板
const expandedPanels = reactive({
    gemini: true,
    openai: false,
    anthropic: false,
    'openai-responses': false
})

// 加载配置
async function loadConfig() {
    isLoading.value = true
    try {
        const response = await sendToExtension<any>('getSettings', {})
        if (response?.settings?.toolsConfig?.token_count) {
            const savedConfig = response.settings.toolsConfig.token_count
            
            if (savedConfig.gemini) {
                Object.assign(config.gemini!, savedConfig.gemini)
            }
            if (savedConfig.openai) {
                Object.assign(config.openai!, savedConfig.openai)
            }
            if (savedConfig.anthropic) {
                Object.assign(config.anthropic!, savedConfig.anthropic)
            }
            if (savedConfig['openai-responses']) {
                Object.assign(config['openai-responses']!, savedConfig['openai-responses'])
            }
        }
    } catch (error) {
        console.error('Failed to load token count config:', error)
    } finally {
        isLoading.value = false
    }
}

// 保存配置
async function saveConfig() {
    isSaving.value = true
    saveMessage.value = ''
    
    try {
        // 将 reactive 对象转换为纯对象，避免 postMessage 序列化问题
        const rawConfig = JSON.parse(JSON.stringify(toRaw(config)))
        
        await sendToExtension('tools.updateToolConfig', {
            toolName: 'token_count',
            config: {
                gemini: rawConfig.gemini,
                openai: rawConfig.openai,
                anthropic: rawConfig.anthropic,
                'openai-responses': rawConfig['openai-responses']
            }
        })
        saveMessage.value = t('components.settings.tokenCountSettings.saveSuccess')
        saveMessageType.value = 'success'
        
        setTimeout(() => {
            saveMessage.value = ''
        }, 3000)
    } catch (error) {
        console.error('Failed to save token count config:', error)
        saveMessage.value = t('components.settings.tokenCountSettings.saveFailed')
        saveMessageType.value = 'error'
    } finally {
        isSaving.value = false
    }
}

// 切换面板展开状态
function togglePanel(panel: 'gemini' | 'openai' | 'anthropic' | 'openai-responses') {
    expandedPanels[panel] = !expandedPanels[panel]
}

// 切换 API Key 可见性
function toggleApiKeyVisibility(channel: 'gemini' | 'openai' | 'anthropic' | 'openai-responses') {
    showApiKey[channel] = !showApiKey[channel]
}

onMounted(() => {
    loadConfig()
})
</script>

<template>
    <div class="token-count-settings">
        <div v-if="isLoading" class="loading">
            <i class="codicon codicon-loading codicon-modifier-spin"></i>
            {{ t('common.loading') }}
        </div>
        
        <template v-else>
            <!-- 说明 -->
            <div class="settings-intro">
                <p>{{ t('components.settings.tokenCountSettings.description') }}</p>
                <p class="hint">{{ t('components.settings.tokenCountSettings.hint') }}</p>
            </div>
            
            <!-- Gemini 配置 -->
            <div class="channel-panel" :class="{ expanded: expandedPanels.gemini }">
                <div class="panel-header" @click="togglePanel('gemini')">
                    <div class="panel-title">
                        <i :class="['codicon', expandedPanels.gemini ? 'codicon-chevron-down' : 'codicon-chevron-right']"></i>
                        <span class="channel-name">Gemini</span>
                        <span v-if="config.gemini?.enabled" class="status-badge enabled">
                            {{ t('common.enabled') }}
                        </span>
                    </div>
                </div>
                
                <div v-if="expandedPanels.gemini" class="panel-content">
                    <div class="form-group">
                        <CustomCheckbox
                            v-model="config.gemini!.enabled"
                            :label="t('components.settings.tokenCountSettings.enableChannel')"
                        />
                    </div>
                    
                    <div class="form-group">
                        <label>{{ t('components.settings.tokenCountSettings.baseUrl') }}</label>
                        <input
                            type="text"
                            v-model="config.gemini!.baseUrl"
                            :placeholder="t('components.settings.tokenCountSettings.geminiUrlPlaceholder')"
                            :disabled="!config.gemini?.enabled"
                        />
                        <p class="field-hint">{{ t('components.settings.tokenCountSettings.geminiUrlHint') }}</p>
                    </div>
                    
                    <div class="form-group">
                        <label>{{ t('components.settings.tokenCountSettings.apiKey') }}</label>
                        <div class="input-with-button">
                            <input
                                :type="showApiKey.gemini ? 'text' : 'password'"
                                v-model="config.gemini!.apiKey"
                                :placeholder="t('components.settings.tokenCountSettings.apiKeyPlaceholder')"
                                :disabled="!config.gemini?.enabled"
                            />
                            <button
                                class="toggle-visibility-btn"
                                @click="toggleApiKeyVisibility('gemini')"
                                type="button"
                            >
                                <i :class="['codicon', showApiKey.gemini ? 'codicon-eye-closed' : 'codicon-eye']"></i>
                            </button>
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <label>{{ t('components.settings.tokenCountSettings.model') }}</label>
                        <input
                            type="text"
                            v-model="config.gemini!.model"
                            :placeholder="t('components.settings.tokenCountSettings.geminiModelPlaceholder')"
                            :disabled="!config.gemini?.enabled"
                        />
                    </div>
                </div>
            </div>
            
            <!-- OpenAI 配置 -->
            <div class="channel-panel" :class="{ expanded: expandedPanels.openai }">
                <div class="panel-header" @click="togglePanel('openai')">
                    <div class="panel-title">
                        <i :class="['codicon', expandedPanels.openai ? 'codicon-chevron-down' : 'codicon-chevron-right']"></i>
                        <span class="channel-name">OpenAI</span>
                        <span class="status-badge custom-api">
                            {{ t('components.settings.tokenCountSettings.customApi') }}
                        </span>
                    </div>
                </div>
                
                <div v-if="expandedPanels.openai" class="panel-content">
                    <div class="api-doc-notice">
                        <i class="codicon codicon-book"></i>
                        <div class="doc-content">
                            <p class="doc-title">{{ t('components.settings.tokenCountSettings.openaiDocTitle') }}</p>
                            <p class="doc-desc">{{ t('components.settings.tokenCountSettings.openaiDocDesc') }}</p>
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <CustomCheckbox
                            v-model="config.openai!.enabled"
                            :label="t('components.settings.tokenCountSettings.enableChannel')"
                        />
                    </div>
                    
                    <div class="form-group">
                        <label>{{ t('components.settings.tokenCountSettings.baseUrl') }}</label>
                        <input
                            type="text"
                            v-model="config.openai!.baseUrl"
                            :placeholder="t('components.settings.tokenCountSettings.openaiUrlPlaceholder')"
                            :disabled="!config.openai?.enabled"
                        />
                        <p class="field-hint">{{ t('components.settings.tokenCountSettings.openaiUrlHint') }}</p>
                    </div>
                    
                    <div class="form-group">
                        <label>{{ t('components.settings.tokenCountSettings.apiKey') }}</label>
                        <div class="input-with-button">
                            <input
                                :type="showApiKey.openai ? 'text' : 'password'"
                                v-model="config.openai!.apiKey"
                                :placeholder="t('components.settings.tokenCountSettings.apiKeyPlaceholder')"
                                :disabled="!config.openai?.enabled"
                            />
                            <button
                                class="toggle-visibility-btn"
                                @click="toggleApiKeyVisibility('openai')"
                                type="button"
                            >
                                <i :class="['codicon', showApiKey.openai ? 'codicon-eye-closed' : 'codicon-eye']"></i>
                            </button>
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <label>{{ t('components.settings.tokenCountSettings.model') }}</label>
                        <input
                            type="text"
                            v-model="config.openai!.model"
                            :placeholder="t('components.settings.tokenCountSettings.openaiModelPlaceholder')"
                            :disabled="!config.openai?.enabled"
                        />
                    </div>
                    
                    <!-- API 接口文档 -->
                    <div class="api-doc-section">
                        <div class="doc-header">
                            <i class="codicon codicon-code"></i>
                            <span>{{ t('components.settings.tokenCountSettings.apiDocumentation') }}</span>
                        </div>
                        <div class="code-block">
                            <div class="code-header">
                                <span>{{ t('components.settings.tokenCountSettings.requestExample') }}</span>
                            </div>
                            <pre class="code-content"><code>POST {baseUrl}
Content-Type: application/json
Authorization: Bearer {apiKey}

{{ t('components.settings.tokenCountSettings.requestBody') }}
{
  "model": "{model}",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "..." }
      ]
    }
  ]
}

{{ t('components.settings.tokenCountSettings.responseFormat') }}
{
  "total_tokens": number
}</code></pre>
                        </div>
                        <p class="doc-note">{{ t('components.settings.tokenCountSettings.openaiDocNote') }}</p>
                    </div>
                </div>
            </div>
            
            <!-- Anthropic 配置 -->
            <div class="channel-panel" :class="{ expanded: expandedPanels.anthropic }">
                <div class="panel-header" @click="togglePanel('anthropic')">
                    <div class="panel-title">
                        <i :class="['codicon', expandedPanels.anthropic ? 'codicon-chevron-down' : 'codicon-chevron-right']"></i>
                        <span class="channel-name">Anthropic</span>
                        <span v-if="config.anthropic?.enabled" class="status-badge enabled">
                            {{ t('common.enabled') }}
                        </span>
                    </div>
                </div>
                
                <div v-if="expandedPanels.anthropic" class="panel-content">
                    <div class="form-group">
                        <CustomCheckbox
                            v-model="config.anthropic!.enabled"
                            :label="t('components.settings.tokenCountSettings.enableChannel')"
                        />
                    </div>
                    
                    <div class="form-group">
                        <label>{{ t('components.settings.tokenCountSettings.baseUrl') }}</label>
                        <input
                            type="text"
                            v-model="config.anthropic!.baseUrl"
                            :placeholder="t('components.settings.tokenCountSettings.anthropicUrlPlaceholder')"
                            :disabled="!config.anthropic?.enabled"
                        />
                    </div>
                    
                    <div class="form-group">
                        <label>{{ t('components.settings.tokenCountSettings.apiKey') }}</label>
                        <div class="input-with-button">
                            <input
                                :type="showApiKey.anthropic ? 'text' : 'password'"
                                v-model="config.anthropic!.apiKey"
                                :placeholder="t('components.settings.tokenCountSettings.apiKeyPlaceholder')"
                                :disabled="!config.anthropic?.enabled"
                            />
                            <button
                                class="toggle-visibility-btn"
                                @click="toggleApiKeyVisibility('anthropic')"
                                type="button"
                            >
                                <i :class="['codicon', showApiKey.anthropic ? 'codicon-eye-closed' : 'codicon-eye']"></i>
                            </button>
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <label>{{ t('components.settings.tokenCountSettings.model') }}</label>
                        <input
                            type="text"
                            v-model="config.anthropic!.model"
                            :placeholder="t('components.settings.tokenCountSettings.anthropicModelPlaceholder')"
                            :disabled="!config.anthropic?.enabled"
                        />
                    </div>
                </div>
            </div>
            
            <!-- OpenAI Responses 配置 -->
            <div class="channel-panel" :class="{ expanded: expandedPanels['openai-responses'] }">
                <div class="panel-header" @click="togglePanel('openai-responses')">
                    <div class="panel-title">
                        <i :class="['codicon', expandedPanels['openai-responses'] ? 'codicon-chevron-down' : 'codicon-chevron-right']"></i>
                        <span class="channel-name">OpenAI Responses</span>
                        <span v-if="config['openai-responses']?.enabled" class="status-badge enabled">
                            {{ t('common.enabled') }}
                        </span>
                    </div>
                </div>
                
                <div v-if="expandedPanels['openai-responses']" class="panel-content">
                    <div class="form-group">
                        <CustomCheckbox
                            v-model="config['openai-responses']!.enabled"
                            :label="t('components.settings.tokenCountSettings.enableChannel')"
                        />
                    </div>
                    
                    <div class="form-group">
                        <label>{{ t('components.settings.tokenCountSettings.baseUrl') }}</label>
                        <input
                            type="text"
                            v-model="config['openai-responses']!.baseUrl"
                            placeholder="https://api.openai.com/v1/responses/input_tokens"
                            :disabled="!config['openai-responses']?.enabled"
                        />
                    </div>
                    
                    <div class="form-group">
                        <label>{{ t('components.settings.tokenCountSettings.apiKey') }}</label>
                        <div class="input-with-button">
                            <input
                                :type="showApiKey['openai-responses'] ? 'text' : 'password'"
                                v-model="config['openai-responses']!.apiKey"
                                :placeholder="t('components.settings.tokenCountSettings.apiKeyPlaceholder')"
                                :disabled="!config['openai-responses']?.enabled"
                            />
                            <button
                                class="toggle-visibility-btn"
                                @click="toggleApiKeyVisibility('openai-responses')"
                                type="button"
                            >
                                <i :class="['codicon', showApiKey['openai-responses'] ? 'codicon-eye-closed' : 'codicon-eye']"></i>
                            </button>
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <label>{{ t('components.settings.tokenCountSettings.model') }}</label>
                        <input
                            type="text"
                            v-model="config['openai-responses']!.model"
                            placeholder="gpt-5"
                            :disabled="!config['openai-responses']?.enabled"
                        />
                    </div>
                </div>
            </div>
            
            <!-- 保存按钮 -->
            <div class="actions">
                <button
                    class="save-btn"
                    @click="saveConfig"
                    :disabled="isSaving"
                >
                    <i v-if="isSaving" class="codicon codicon-loading codicon-modifier-spin"></i>
                    <span v-else>{{ t('common.save') }}</span>
                </button>
                <span v-if="saveMessage" class="save-message" :class="saveMessageType">
                    {{ saveMessage }}
                </span>
            </div>
        </template>
    </div>
</template>

<style scoped>
.token-count-settings {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.loading {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--vscode-descriptionForeground);
    padding: 20px;
}

.settings-intro {
    padding: 12px;
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
}

.settings-intro p {
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
}

.settings-intro .hint {
    margin-top: 8px;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
}

/* 渠道面板 */
.channel-panel {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    overflow: hidden;
}

.channel-panel.expanded {
    border-color: var(--vscode-focusBorder);
}

.panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
    background: var(--vscode-editor-background);
    cursor: pointer;
    user-select: none;
}

.panel-header:hover {
    background: var(--vscode-list-hoverBackground);
}

.panel-title {
    display: flex;
    align-items: center;
    gap: 8px;
}

.panel-title .codicon {
    font-size: 14px;
    color: var(--vscode-foreground);
}

.channel-name {
    font-size: 14px;
    font-weight: 500;
}

.status-badge {
    padding: 2px 8px;
    font-size: 11px;
    border-radius: 10px;
    font-weight: 500;
}

.status-badge.enabled {
    background: rgba(0, 200, 0, 0.15);
    color: var(--vscode-terminal-ansiGreen);
}

.status-badge.coming-soon {
    background: rgba(255, 200, 0, 0.15);
    color: var(--vscode-editorWarning-foreground);
}

.panel-content {
    padding: 12px;
    border-top: 1px solid var(--vscode-panel-border);
    display: flex;
    flex-direction: column;
    gap: 12px;
}

/* 即将推出提示 */
.coming-soon-notice {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px;
    background: rgba(255, 200, 0, 0.1);
    border-radius: 4px;
    color: var(--vscode-editorWarning-foreground);
}

.coming-soon-notice .codicon {
    flex-shrink: 0;
    margin-top: 2px;
}

.coming-soon-notice p {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
}

/* 表单组 */
.form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.form-group.disabled {
    opacity: 0.6;
}

.form-group label {
    font-size: 12px;
    font-weight: 500;
    color: var(--vscode-foreground);
}

.form-group input {
    padding: 8px 12px;
    font-size: 13px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 4px;
    outline: none;
    transition: border-color 0.15s;
}

.form-group input:focus {
    border-color: var(--vscode-focusBorder);
}

.form-group input:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}

.field-hint {
    margin: 0;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
}

/* 带按钮的输入框 */
.input-with-button {
    display: flex;
    gap: 4px;
}

.input-with-button input {
    flex: 1;
}

.toggle-visibility-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: background-color 0.15s;
}

.toggle-visibility-btn:hover:not(:disabled) {
    background: var(--vscode-button-secondaryHoverBackground);
}

.toggle-visibility-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}

/* 操作按钮 */
.actions {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 8px;
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
}

.save-message.success {
    color: var(--vscode-terminal-ansiGreen);
}

.save-message.error {
    color: var(--vscode-errorForeground);
}

/* Custom API badge */
.status-badge.custom-api {
    background: rgba(100, 150, 255, 0.15);
    color: var(--vscode-textLink-foreground);
}

/* API 文档通知 */
.api-doc-notice {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px;
    background: rgba(100, 150, 255, 0.1);
    border-radius: 6px;
    border: 1px solid rgba(100, 150, 255, 0.2);
}

.api-doc-notice .codicon {
    flex-shrink: 0;
    font-size: 16px;
    color: var(--vscode-textLink-foreground);
    margin-top: 2px;
}

.api-doc-notice .doc-content {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.api-doc-notice .doc-title {
    margin: 0;
    font-size: 13px;
    font-weight: 500;
    color: var(--vscode-foreground);
}

.api-doc-notice .doc-desc {
    margin: 0;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    line-height: 1.5;
}

/* API 文档区域 */
.api-doc-section {
    margin-top: 8px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    overflow: hidden;
}

.api-doc-section .doc-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: var(--vscode-editor-background);
    font-size: 12px;
    font-weight: 500;
    color: var(--vscode-foreground);
    border-bottom: 1px solid var(--vscode-panel-border);
}

.api-doc-section .doc-header .codicon {
    font-size: 14px;
}

.code-block {
    background: var(--vscode-textCodeBlock-background);
}

.code-block .code-header {
    padding: 8px 12px;
    font-size: 11px;
    font-weight: 500;
    color: var(--vscode-descriptionForeground);
    background: rgba(0, 0, 0, 0.1);
    border-bottom: 1px solid var(--vscode-panel-border);
}

.code-block .code-content {
    margin: 0;
    padding: 12px;
    font-size: 12px;
    font-family: var(--vscode-editor-font-family);
    line-height: 1.6;
    overflow-x: auto;
    color: var(--vscode-editor-foreground);
}

.code-block .code-content code {
    font-family: inherit;
    white-space: pre;
}

.api-doc-section .doc-note {
    margin: 0;
    padding: 10px 12px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    background: var(--vscode-editor-background);
    border-top: 1px solid var(--vscode-panel-border);
    line-height: 1.5;
}

/* Loading 动画 */
.codicon-modifier-spin {
    animation: spin 1s linear infinite;
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}
</style>