<script setup lang="ts">
/**
 * read_skill_resource 工具结果展示组件。
 *
 * 为什么要加：Skill resource 读取结果通常包含长 Markdown 文档；通用 JSON 显示难读，
 * 且会把安全审计关注点埋在大对象里。
 * 怎么改：组件只读取并展示白名单字段：skillName/name、relativePath、短 sha、truncated、content。
 * 目的：保持 Skill 资源访问的渐进式披露体验，同时不展示任何绝对路径或 staging 信息。
 */
import { computed, ref } from 'vue'
import { useI18n } from '../../../i18n'
import type { ToolUsage } from '../../../types'
import {
  asBoolean,
  asString,
  getRelativePath,
  getResultData,
  getSkillName,
  isPendingStatus,
  previewText,
  shortSha256
} from '../../../utils/tools/skills/skillToolDisplay'

const props = defineProps<{
  args: Record<string, unknown>
  result?: Record<string, unknown>
  error?: string
  status?: ToolUsage['status']
  toolId?: string
  toolName?: string
}>()

const { t } = useI18n()

const expanded = ref(false)
const copied = ref(false)

const data = computed(() => getResultData(props.result))
const skillName = computed(() => getSkillName(props.args, data.value))
const relativePath = computed(() => getRelativePath(props.args, data.value))
const sha = computed(() => shortSha256(data.value?.sha256))
const truncated = computed(() => asBoolean(data.value?.truncated))
const contentPreview = computed(() => previewText(data.value?.content, expanded.value ? 20000 : 6000))
const content = computed(() => contentPreview.value.text)
const isPending = computed(() => isPendingStatus(props.status, props.result, props.error))
const isSuccess = computed(() => props.result?.success === true && !!data.value)
const errorMessage = computed(() => props.error || asString(props.result?.error))

async function copyContent() {
  if (!content.value) return
  try {
    await navigator.clipboard.writeText(content.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1000)
  } catch (error) {
    console.error('Copy skill resource content failed:', error)
  }
}
</script>

<template>
  <div class="skill-resource-card" :class="{ pending: isPending, success: isSuccess, error: !!errorMessage }">
    <div class="skill-resource-header">
      <div class="resource-title" :title="relativePath">
        <i class="codicon codicon-file-text"></i>
        <span class="resource-path">{{ relativePath }}</span>
      </div>
      <div class="resource-badges">
        <span class="skill-badge" :title="skillName">{{ skillName }}</span>
        <span v-if="sha" class="meta-badge" :title="asString(data?.sha256)">{{ sha }}</span>
        <span v-if="truncated" class="meta-badge warning">{{ t('components.tools.skills.readResource.badgeTruncated') }}</span>
      </div>
    </div>

    <div v-if="isPending" class="resource-state pending-state">
      <i class="codicon codicon-loading codicon-modifier-spin"></i>
      <span>{{ t('components.tools.skills.readResource.reading') }}</span>
    </div>

    <div v-else-if="errorMessage" class="resource-state error-state">
      <i class="codicon codicon-error"></i>
      <span>{{ errorMessage }}</span>
    </div>

    <template v-else>
      <div class="resource-preview" :class="{ expanded }">
        <pre v-if="content" class="resource-content">{{ content }}</pre>
        <div v-else class="empty-content">{{ t('components.tools.skills.readResource.noContent') }}</div>
        <div v-if="!expanded && (contentPreview.clipped || truncated)" class="fade-overlay"></div>
      </div>

      <div class="resource-actions">
        <button class="action-button" type="button" @click.stop="expanded = !expanded">
          <i class="codicon" :class="expanded ? 'codicon-chevron-up' : 'codicon-chevron-down'"></i>
          {{ expanded ? t('common.collapse') : t('common.expand') }}
        </button>
        <button class="action-button" type="button" :class="{ copied }" @click.stop="copyContent">
          <i class="codicon" :class="copied ? 'codicon-check' : 'codicon-copy'"></i>
          {{ copied ? t('common.copied') : t('common.copy') }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.skill-resource-card {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin: 8px 0;
  overflow: hidden;
  border: 1px solid var(--vscode-panel-border);
  border-left: 3px solid var(--vscode-descriptionForeground);
  border-radius: 4px;
  background: var(--vscode-editor-background);
}

.skill-resource-card.success {
  border-left-color: var(--vscode-terminal-ansiGreen, var(--vscode-testing-iconPassed));
}

.skill-resource-card.error {
  border-left-color: var(--vscode-errorForeground, var(--vscode-testing-iconFailed));
}

.skill-resource-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editor-inactiveSelectionBackground);
}

.resource-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--vscode-foreground);
  font-size: 12px;
  font-weight: 500;
}

.resource-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--vscode-editor-font-family), monospace;
}

.resource-badges {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.skill-badge,
.meta-badge {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10px;
  color: var(--vscode-badge-foreground);
  background: var(--vscode-badge-background);
}

.meta-badge {
  color: var(--vscode-descriptionForeground);
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  font-family: var(--vscode-editor-font-family), monospace;
}

.meta-badge.warning {
  color: var(--vscode-charts-yellow, var(--vscode-descriptionForeground));
}

.resource-state {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px;
  font-size: 12px;
}

.pending-state {
  color: var(--vscode-descriptionForeground);
}

.error-state {
  color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground));
  background: var(--vscode-inputValidation-errorBackground, var(--vscode-editor-background));
}

.resource-preview {
  position: relative;
  max-height: 220px;
  overflow: hidden;
  background: var(--vscode-editor-background);
}

.resource-preview.expanded {
  max-height: 520px;
  overflow: auto;
}

.resource-content {
  margin: 0;
  padding: 10px;
  color: var(--vscode-foreground);
  font-family: var(--vscode-editor-font-family), monospace;
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.empty-content {
  padding: 10px;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}

.fade-overlay {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 28px;
  pointer-events: none;
  background: linear-gradient(to bottom, transparent, var(--vscode-editor-background));
}

.resource-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  padding: 5px 8px;
  border-top: 1px dashed var(--vscode-panel-border);
  background: var(--vscode-editor-inactiveSelectionBackground);
}

.action-button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border: none;
  border-radius: 3px;
  color: var(--vscode-descriptionForeground);
  background: transparent;
  font-size: 11px;
  cursor: pointer;
}

.action-button:hover {
  color: var(--vscode-foreground);
  background: var(--vscode-toolbar-hoverBackground);
}

.action-button.copied {
  color: var(--vscode-terminal-ansiGreen, var(--vscode-testing-iconPassed));
}
</style>
