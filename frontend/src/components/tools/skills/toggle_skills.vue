<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  args: Record<string, unknown>
  result?: Record<string, unknown>
}>()

// 检查是否成功
const isSuccess = computed(() => props.result?.success === true)

// 获取错误信息（如果有未找到的 skills）
const errorMessage = computed(() => props.result?.error as string | undefined)

// 解析参数中的 skills
const requestedSkills = computed(() => {
  const skills: { name: string; enabled: boolean }[] = []
  for (const [name, enabled] of Object.entries(props.args)) {
    if (typeof enabled === 'boolean') {
      skills.push({ name, enabled })
    }
  }
  return skills
})
</script>

<template>
  <div class="toggle-skills-content">
    <!-- 请求的操作 -->
    <div v-if="requestedSkills.length > 0" class="section">
      <div class="section-title">Requested Changes:</div>
      <div class="skills-list">
        <div
          v-for="skill in requestedSkills"
          :key="skill.name"
          class="skill-item"
          :class="{ enabled: skill.enabled, disabled: !skill.enabled }"
        >
          <i :class="['codicon', skill.enabled ? 'codicon-check' : 'codicon-close']"></i>
          <span class="skill-name">{{ skill.name }}</span>
          <span class="skill-action">{{ skill.enabled ? 'Enable' : 'Disable' }}</span>
        </div>
      </div>
    </div>
    
    <!-- 结果状态 -->
    <template v-if="result">
      <!-- 成功 -->
      <div v-if="isSuccess && !errorMessage" class="section success">
        <div class="section-title">
          <i class="codicon codicon-pass"></i>
          Success
        </div>
      </div>
      
      <!-- 部分成功（有未找到的 skills） -->
      <div v-else-if="isSuccess && errorMessage" class="section warning">
        <div class="section-title">
          <i class="codicon codicon-warning"></i>
          {{ errorMessage }}
        </div>
      </div>
      
      <!-- 失败 -->
      <div v-else class="section error">
        <div class="section-title">
          <i class="codicon codicon-error"></i>
          Failed{{ errorMessage ? `: ${errorMessage}` : '' }}
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.toggle-skills-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
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

.section.warning .section-title {
  color: var(--vscode-editorWarning-foreground);
}

.section.error .section-title {
  color: var(--vscode-errorForeground);
}

.skills-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.skill-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--vscode-editor-background);
  border-radius: 4px;
  font-size: 12px;
}

.skill-item.enabled {
  border-left: 3px solid var(--vscode-terminal-ansiGreen);
}

.skill-item.disabled {
  border-left: 3px solid var(--vscode-descriptionForeground);
}

.skill-item .codicon {
  font-size: 14px;
}

.skill-item.enabled .codicon {
  color: var(--vscode-terminal-ansiGreen);
}

.skill-item.disabled .codicon {
  color: var(--vscode-descriptionForeground);
}

.skill-name {
  flex: 1;
  font-family: var(--vscode-editor-font-family), monospace;
}

.skill-action {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}
</style>
