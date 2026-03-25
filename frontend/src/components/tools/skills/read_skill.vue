<script setup lang="ts">
/**
 * read_skill 工具结果展示组件
 * 
 * 显示 AI 加载的 Skill 信息：名称、basePath、内容长度。
 * 替代原有的 toggle_skills.vue。
 */
import { computed } from 'vue'

const props = defineProps<{
  args: Record<string, unknown>
  result?: Record<string, unknown>
}>()

// 请求的 skill 名称
const skillName = computed(() => props.args?.name as string || 'unknown')

// 检查是否成功
const isSuccess = computed(() => props.result?.success === true)

// 获取错误信息
const errorMessage = computed(() => props.result?.error as string | undefined)

// 获取返回数据
const resultData = computed(() => props.result?.data as { name?: string; basePath?: string; content?: string } | undefined)

// 内容长度
const contentLength = computed(() => {
  const content = resultData.value?.content
  return content ? content.length : 0
})
</script>

<template>
  <div class="read-skill-content">
    <!-- 结果状态 -->
    <template v-if="result">
      <!-- 成功 -->
      <div v-if="isSuccess && resultData" class="section success">
        <div class="section-title">
          <i class="codicon codicon-book"></i>
          Loaded skill: {{ resultData.name || skillName }}
        </div>
        <div class="skill-details">
          <div class="detail-item">
            <span class="detail-label">Base path:</span>
            <span class="detail-value">{{ resultData.basePath }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Content:</span>
            <span class="detail-value">{{ contentLength.toLocaleString() }} chars</span>
          </div>
        </div>
      </div>
      
      <!-- 失败 -->
      <div v-else class="section error">
        <div class="section-title">
          <i class="codicon codicon-error"></i>
          Failed to load skill: {{ skillName }}
        </div>
        <div v-if="errorMessage" class="error-detail">{{ errorMessage }}</div>
      </div>
    </template>

    <!-- 等待结果 -->
    <div v-else class="section pending">
      <div class="section-title">
        <i class="codicon codicon-loading codicon-modifier-spin"></i>
        Loading skill: {{ skillName }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.read-skill-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 0;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--vscode-foreground);
}

.section.success .section-title {
  color: var(--vscode-terminal-ansiGreen);
}

.section.error .section-title {
  color: var(--vscode-errorForeground);
}

.section.pending .section-title {
  color: var(--vscode-descriptionForeground);
}

.skill-details {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 10px;
  background: var(--vscode-editor-background);
  border-radius: 4px;
  border-left: 3px solid var(--vscode-terminal-ansiGreen);
}

.detail-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}

.detail-label {
  color: var(--vscode-descriptionForeground);
  flex-shrink: 0;
}

.detail-value {
  font-family: var(--vscode-editor-font-family), monospace;
  color: var(--vscode-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.error-detail {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  padding: 4px 10px;
}
</style>
