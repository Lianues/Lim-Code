<script setup lang="ts">
import { computed, ref } from 'vue'
import { CustomSelect, type SelectOption } from '../../common'
import { t } from '@/i18n'

// Token 计数方式类型
type TokenCountMethod = 'channel_default' | 'gemini' | 'openai_custom' | 'openai_responses' | 'anthropic' | 'local'

// Token 计数 API 配置
interface TokenCountApiConfig {
    url?: string
    apiKey?: string
    model?: string
}

// Props
interface Props {
    tokenCountMethod?: TokenCountMethod
    tokenCountApiConfig?: TokenCountApiConfig
    channelType: 'gemini' | 'openai' | 'anthropic'
}

const props = withDefaults(defineProps<Props>(), {
    tokenCountMethod: 'channel_default',
    tokenCountApiConfig: () => ({})
})

// Emits
const emit = defineEmits<{
    (e: 'update:tokenCountMethod', value: TokenCountMethod): void
    (e: 'update:tokenCountApiConfig', value: TokenCountApiConfig): void
}>()

// API Key 可见性
const showApiKey = ref(false)

// Token 计数方式选项
const methodOptions = computed<SelectOption[]>(() => {
    const options: SelectOption[] = [
        {
            value: 'channel_default',
            label: t('components.channels.tokenCountMethod.options.channelDefault'),
            description: getDefaultMethodDescription()
        },
        {
            value: 'gemini',
            label: t('components.channels.tokenCountMethod.options.gemini'),
            description: 'Gemini countTokens API'
        },
        {
            value: 'openai_custom',
            label: t('components.channels.tokenCountMethod.options.openaiCustom'),
            description: t('components.channels.tokenCountMethod.options.openaiCustomDesc')
        },
        {
            value: 'openai_responses',
            label: t('components.channels.tokenCountMethod.options.openaiResponses'),
            description: 'OpenAI Responses input_tokens API'
        },
        {
            value: 'anthropic',
            label: t('components.channels.tokenCountMethod.options.anthropic'),
            description: 'Anthropic count_tokens API'
        },
        {
            value: 'local',
            label: t('components.channels.tokenCountMethod.options.local'),
            description: t('components.channels.tokenCountMethod.options.localDesc')
        }
    ]
    return options
})

// 获取默认方式的描述
function getDefaultMethodDescription(): string {
    switch (props.channelType) {
        case 'gemini':
            return t('components.channels.tokenCountMethod.defaultDesc.gemini')
        case 'anthropic':
            return t('components.channels.tokenCountMethod.defaultDesc.anthropic')
        case 'openai':
        default:
            return t('components.channels.tokenCountMethod.defaultDesc.openai')
    }
}

// 是否需要显示 API 配置
const showApiConfig = computed(() => {
    const method = props.tokenCountMethod || 'channel_default'
    // 以下方式需要独立配置 API
    return method === 'gemini' || method === 'openai_custom' || method === 'openai_responses' || method === 'anthropic'
})

// 获取 URL 占位符
const urlPlaceholder = computed(() => {
    const method = props.tokenCountMethod || 'channel_default'
    switch (method) {
        case 'gemini':
            return 'https://generativelanguage.googleapis.com/v1beta/models/{model}:countTokens?key={key}'
        case 'openai_custom':
            return 'https://api.example.com/v1/count_tokens'
        case 'openai_responses':
            return 'https://api.openai.com/v1/responses/input_tokens'
        case 'anthropic':
            return 'https://api.anthropic.com/v1/messages/count_tokens'
        default:
            return ''
    }
})

// 获取模型占位符
const modelPlaceholder = computed(() => {
    const method = props.tokenCountMethod || 'channel_default'
    switch (method) {
        case 'gemini':
            return 'gemini-2.5-pro'
        case 'anthropic':
            return 'claude-sonnet-4-5'
        case 'openai_responses':
            return 'gpt-5'
        default:
            return ''
    }
})

// 更新方法
function updateMethod(value: string) {
    emit('update:tokenCountMethod', value as TokenCountMethod)
}

// 更新 API 配置
function updateApiConfig(field: keyof TokenCountApiConfig, value: string) {
    const newConfig = {
        ...props.tokenCountApiConfig,
        [field]: value
    }
    emit('update:tokenCountApiConfig', newConfig)
}
</script>

<template>
    <div class="token-count-method-settings">
        <!-- 方式选择 -->
        <div class="option-item">
            <div class="option-header">
                <label>{{ t('components.channels.tokenCountMethod.label') }}</label>
            </div>
            <CustomSelect
                :model-value="tokenCountMethod || 'channel_default'"
                :options="methodOptions"
                :placeholder="t('components.channels.tokenCountMethod.placeholder')"
                @update:model-value="updateMethod"
            />
            <span class="option-hint">
                {{ t('components.channels.tokenCountMethod.hint') }}
            </span>
        </div>
        
        <!-- API 配置（仅当需要时显示） -->
        <template v-if="showApiConfig">
            <div class="api-config-section">
                <div class="api-config-title">
                    <i class="codicon codicon-settings-gear"></i>
                    {{ t('components.channels.tokenCountMethod.apiConfig.title') }}
                </div>
                
                <!-- URL -->
                <div class="option-item">
                    <div class="option-header">
                        <label>{{ t('components.channels.tokenCountMethod.apiConfig.url') }}</label>
                    </div>
                    <input
                        type="text"
                        :value="tokenCountApiConfig?.url || ''"
                        :placeholder="urlPlaceholder"
                        @input="(e: any) => updateApiConfig('url', e.target.value)"
                    />
                    <span class="option-hint">
                        {{ t('components.channels.tokenCountMethod.apiConfig.urlHint') }}
                    </span>
                </div>
                
                <!-- API Key -->
                <div class="option-item">
                    <div class="option-header">
                        <label>{{ t('components.channels.tokenCountMethod.apiConfig.apiKey') }}</label>
                    </div>
                    <div class="input-with-action">
                        <input
                            :type="showApiKey ? 'text' : 'password'"
                            :value="tokenCountApiConfig?.apiKey || ''"
                            :placeholder="t('components.channels.tokenCountMethod.apiConfig.apiKeyPlaceholder')"
                            @input="(e: any) => updateApiConfig('apiKey', e.target.value)"
                        />
                        <button
                            class="input-action-btn"
                            :title="showApiKey ? t('common.hide') : t('common.show')"
                            @click="showApiKey = !showApiKey"
                        >
                            <i :class="['codicon', showApiKey ? 'codicon-eye-closed' : 'codicon-eye']"></i>
                        </button>
                    </div>
                    <span class="option-hint">
                        {{ t('components.channels.tokenCountMethod.apiConfig.apiKeyHint') }}
                    </span>
                </div>
                
                <!-- 模型（仅 Gemini、Anthropic 和 OpenAI Responses） -->
                <div v-if="tokenCountMethod === 'gemini' || tokenCountMethod === 'anthropic' || tokenCountMethod === 'openai_responses'" class="option-item">
                    <div class="option-header">
                        <label>{{ t('components.channels.tokenCountMethod.apiConfig.model') }}</label>
                    </div>
                    <input
                        type="text"
                        :value="tokenCountApiConfig?.model || ''"
                        :placeholder="modelPlaceholder"
                        @input="(e: any) => updateApiConfig('model', e.target.value)"
                    />
                    <span class="option-hint">
                        {{ t('components.channels.tokenCountMethod.apiConfig.modelHint') }}
                    </span>
                </div>
            </div>
        </template>
    </div>
</template>

<style scoped>
.token-count-method-settings {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.option-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.option-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
}

.option-header label {
    font-size: 11px;
    font-weight: 500;
    color: var(--vscode-foreground);
    opacity: 0.9;
}

.option-item input[type="text"],
.option-item input[type="password"] {
    padding: 5px 8px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 2px;
    font-size: 12px;
}

.option-item input:focus {
    outline: none;
    border-color: var(--vscode-focusBorder);
}

.option-hint {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    opacity: 0.8;
}

/* API 配置区域 */
.api-config-section {
    margin-top: 8px;
    padding: 12px;
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.api-config-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 500;
    color: var(--vscode-foreground);
    padding-bottom: 8px;
    border-bottom: 1px solid var(--vscode-panel-border);
}

.api-config-title .codicon {
    font-size: 14px;
}

/* 带操作按钮的输入框 */
.input-with-action {
    display: flex;
    gap: 4px;
}

.input-with-action input {
    flex: 1;
}

.input-action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    padding: 0;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: none;
    border-radius: 2px;
    cursor: pointer;
}

.input-action-btn:hover {
    background: var(--vscode-button-secondaryHoverBackground);
}
</style>