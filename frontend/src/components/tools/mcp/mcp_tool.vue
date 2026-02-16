<script setup lang="ts">
/**
 * MCP 工具调用显示组件
 *
 * 用于显示 MCP 工具的请求参数和响应结果
 */

import { computed } from 'vue'
import { useI18n } from '../../../composables/useI18n'

interface MultimodalData {
  mimeType: string
  data: string
  name?: string
}

const { t } = useI18n()

const props = defineProps<{
  args: Record<string, unknown>
  result?: Record<string, unknown>
  error?: string
  status?: string
  toolId?: string
}>()

// 格式化 JSON
function formatJson(data: unknown): string {
  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}

// 是否有结果
const hasResult = computed(() => {
  return props.result !== undefined && props.result !== null
})

// 是否有错误
const hasError = computed(() => {
  return !!props.error
})

// 请求 JSON
const requestJson = computed(() => formatJson(props.args))

// 响应 JSON
const responseJson = computed(() => {
  if (hasError.value) {
    return props.error || ''
  }

  if (!props.result) {
    return ''
  }

  // 有多模态返回时，避免在 JSON 中直接展示超长 base64
  if (multimodalData.value.length > 0) {
    try {
      const sanitized = JSON.parse(JSON.stringify(props.result)) as Record<string, unknown>
      const multimodal = sanitized.multimodal

      if (Array.isArray(multimodal)) {
        sanitized.multimodal = multimodal.map((item: any) => ({
          mimeType: item?.mimeType,
          name: item?.name,
          data: typeof item?.data === 'string' ? `<base64:${item.data.length} chars>` : item?.data
        }))
      }

      return formatJson(sanitized)
    } catch {
      return formatJson(props.result)
    }
  }

  return formatJson(props.result)
})

// MCP 返回的图片预览（只渲染 image/*）
const multimodalData = computed<MultimodalData[]>(() => {
  if (!props.result) {
    return []
  }

  const result = props.result as { multimodal?: unknown }
  if (!Array.isArray(result.multimodal)) {
    return []
  }

  return result.multimodal
    .filter((item): item is MultimodalData => {
      if (!item || typeof item !== 'object') {
        return false
      }

      const data = (item as any).data
      const mimeType = (item as any).mimeType
      if (typeof data !== 'string' || !data) {
        return false
      }
      if (typeof mimeType !== 'string') {
        return false
      }

      return mimeType.toLowerCase().startsWith('image/')
    })
    .map(item => ({
      mimeType: item.mimeType,
      data: item.data,
      name: item.name
    }))
})
</script>

<template>
  <div class="mcp-tool-content">
    <!-- 请求参数 -->
    <div class="content-section">
      <div class="section-header">
        <span class="section-icon codicon codicon-arrow-up"></span>
        <span class="section-label">{{ t('components.tools.mcp.mcpToolPanel.requestParams') }}</span>
      </div>
      <pre class="json-content request">{{ requestJson }}</pre>
    </div>

    <!-- 响应结果 -->
    <div v-if="hasResult || hasError" class="content-section">
      <div class="section-header">
        <span class="section-icon codicon" :class="hasError ? 'codicon-error' : 'codicon-arrow-down'"></span>
        <span class="section-label">{{ hasError ? t('components.tools.mcp.mcpToolPanel.errorInfo') : t('components.tools.mcp.mcpToolPanel.responseResult') }}</span>
      </div>

      <div v-if="!hasError && multimodalData.length > 0" class="image-preview-section">
        <div class="image-preview-header">
          <span class="section-icon codicon codicon-device-camera"></span>
          <span class="section-label">{{ t('components.tools.mcp.mcpToolPanel.imagePreview') }}</span>
        </div>

        <div class="image-grid">
          <div
            v-for="(img, index) in multimodalData"
            :key="`${img.name || 'image'}-${index}`"
            class="image-card"
          >
            <img
              :src="`data:${img.mimeType};base64,${img.data}`"
              :alt="img.name || `mcp-image-${index + 1}`"
              class="preview-image"
            />

            <div class="image-name">
              {{ img.name || `image_${index + 1}` }}
            </div>
          </div>
        </div>
      </div>

      <pre class="json-content" :class="{ error: hasError, response: !hasError }">{{ responseJson }}</pre>
    </div>

    <!-- 等待响应状态 -->
    <div
      v-else-if="status === 'executing' || status === 'queued' || status === 'streaming' || status === 'awaiting_approval'"
      class="loading-section"
    >
      <span class="loading-icon codicon codicon-loading"></span>
      <span class="loading-text">{{ t('components.tools.mcp.mcpToolPanel.waitingResponse') }}</span>
    </div>
  </div>
</template>

<style scoped>
.mcp-tool-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.content-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.section-icon {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

.section-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--vscode-descriptionForeground);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.json-content {
  margin: 0;
  padding: 8px 12px;
  font-size: 12px;
  font-family: var(--vscode-editor-font-family), 'Consolas', 'Monaco', monospace;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  border-radius: 4px;
  overflow-x: auto;
}

.json-content.request {
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  color: var(--vscode-foreground);
}

.json-content.response {
  background: color-mix(in srgb, var(--vscode-testing-iconPassed) 10%, var(--vscode-editor-background));
  border: 1px solid color-mix(in srgb, var(--vscode-testing-iconPassed) 30%, var(--vscode-panel-border));
  color: var(--vscode-foreground);
}

.json-content.error {
  background: var(--vscode-inputValidation-errorBackground);
  border: 1px solid var(--vscode-inputValidation-errorBorder);
  color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground));
}

.image-preview-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 4px;
}

.image-preview-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 8px;
}

.image-card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  overflow: hidden;
  background: var(--vscode-editor-background);
}

.preview-image {
  width: 100%;
  max-height: 220px;
  object-fit: contain;
  display: block;
  background: color-mix(in srgb, var(--vscode-editor-background) 60%, var(--vscode-sideBar-background));
}

.image-name {
  padding: 6px 8px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  word-break: break-all;
  border-top: 1px solid var(--vscode-panel-border);
}

.loading-section {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
}

.loading-icon {
  font-size: 14px;
  color: var(--vscode-testing-runAction);
  animation: spin 1s linear infinite;
}

.loading-text {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>