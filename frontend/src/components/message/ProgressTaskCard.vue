<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from '../../i18n'
import { TaskCard, MarkdownRenderer } from '../common'
import type {
  ProgressCardData,
  ProgressCardPhase,
  ProgressCardStatus,
  ProgressToolName,
} from '../../utils/progressCards'
import { copyToClipboard } from '../../utils/format'
import { sendToExtension, showNotification } from '../../utils/vscode'

const props = withDefaults(defineProps<{
  card: ProgressCardData
  content?: string
  status?: 'pending' | 'running' | 'success' | 'error'
  defaultExpanded?: boolean
  error?: string
  warnings?: string[]
  showRawResult?: boolean
}>(), {
  content: '',
  status: 'success',
  defaultExpanded: false,
  error: '',
  warnings: () => [],
  showRawResult: false,
})

const { t } = useI18n()

const copied = ref(false)
let copyResetTimer: ReturnType<typeof setTimeout> | undefined

function getSourceToolLabel(sourceTool: ProgressToolName): string {
  switch (sourceTool) {
    case 'create_progress':
      return t('components.message.tool.progressCard.sourceCreate')
    case 'update_progress':
      return t('components.message.tool.progressCard.sourceUpdate')
    case 'record_progress_milestone':
      return t('components.message.tool.progressCard.sourceMilestone')
    case 'validate_progress_document':
      return t('components.message.tool.progressCard.sourceValidate')
  }
}

function getCardIcon(sourceTool: ProgressToolName): string {
  switch (sourceTool) {
    case 'create_progress':
      return 'codicon-book'
    case 'update_progress':
      return 'codicon-sync'
    case 'record_progress_milestone':
      return 'codicon-checklist'
    case 'validate_progress_document':
      return 'codicon-verified'
  }
}

function getStatusLabel(status?: ProgressCardStatus): string {
  switch (status) {
    case 'active':
      return t('components.message.tool.progressCard.statusActive')
    case 'blocked':
      return t('components.message.tool.progressCard.statusBlocked')
    case 'completed':
      return t('components.message.tool.progressCard.statusCompleted')
    case 'archived':
      return t('components.message.tool.progressCard.statusArchived')
    default:
      return ''
  }
}

function getPhaseLabel(phase?: ProgressCardPhase): string {
  switch (phase) {
    case 'design':
      return t('components.message.tool.progressCard.phaseDesign')
    case 'plan':
      return t('components.message.tool.progressCard.phasePlan')
    case 'implementation':
      return t('components.message.tool.progressCard.phaseImplementation')
    case 'review':
      return t('components.message.tool.progressCard.phaseReview')
    case 'maintenance':
      return t('components.message.tool.progressCard.phaseMaintenance')
    default:
      return ''
  }
}

function getMilestoneStatusLabel(status?: ProgressCardData['latestMilestoneStatus']): string {
  if (status === 'completed') return t('components.message.tool.progressCard.milestoneStatusCompleted')
  if (status === 'in_progress') return t('components.message.tool.progressCard.milestoneStatusInProgress')
  return ''
}

function getValidationLabel(card: ProgressCardData): string {
  if (card.isValid === false) return t('components.message.tool.progressCard.validationInvalid')
  if ((card.warningCount || 0) > 0) return t('components.message.tool.progressCard.validationWarning')
  if (card.isValid === true) return t('components.message.tool.progressCard.validationValid')
  return ''
}

function getIssueSeverityLabel(severity?: 'error' | 'warning'): string {
  return severity === 'error'
    ? t('components.message.tool.progressCard.issueError')
    : t('components.message.tool.progressCard.issueWarning')
}

type ProgressSummaryItem = {
  key: string
  label: string
  value: string
}

const title = computed(() => props.card.title || t('components.message.tool.progressCard.defaultTitle'))
const subtitle = computed(() => props.card.path || undefined)
const footerRight = computed(() => {
  const parts = [getSourceToolLabel(props.card.sourceTool), props.card.updatedAt || ''].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : undefined
})

const metaChips = computed(() => {
  const chips: string[] = []
  const statusLabel = getStatusLabel(props.card.status)
  if (statusLabel) chips.push(statusLabel)
  const phaseLabel = getPhaseLabel(props.card.phase)
  if (phaseLabel) chips.push(phaseLabel)

  const validationLabel = getValidationLabel(props.card)
  if (validationLabel) chips.push(validationLabel)

  return chips
})

const preview = computed(() => {
  const blocks: string[] = []
  if (props.card.currentFocus) {
    blocks.push([
      t('components.message.tool.progressCard.currentFocus'),
      props.card.currentFocus
    ].join('\n'))
  }
  if (props.card.currentProgress) {
    blocks.push([
      t('components.message.tool.progressCard.currentProgress'),
      props.card.currentProgress
    ].join('\n'))
  }
  if (props.card.latestConclusionPreview) {
    blocks.push([
      t('components.message.tool.progressCard.latestConclusion'),
      props.card.latestConclusionPreview
    ].join('\n'))
  }
  if (props.card.currentBlockerPreview) {
    blocks.push([
      t('components.message.tool.progressCard.currentBlocker'),
      props.card.currentBlockerPreview
    ].join('\n'))
  }
  if (props.card.nextActionPreview) {
    blocks.push([
      t('components.message.tool.progressCard.nextAction'),
      props.card.nextActionPreview
    ].join('\n'))
  }
  return blocks.join('\n\n')
})

const summaryItems = computed<ProgressSummaryItem[]>(() => {
  const items: ProgressSummaryItem[] = []

  const statusLabel = getStatusLabel(props.card.status)
  if (statusLabel) {
    items.push({
      key: 'status',
      label: t('components.message.tool.progressCard.status'),
      value: statusLabel
    })
  }

  const phaseLabel = getPhaseLabel(props.card.phase)
  if (phaseLabel) {
    items.push({
      key: 'phase',
      label: t('components.message.tool.progressCard.phase'),
      value: phaseLabel
    })
  }

  if (props.card.currentProgress) {
    items.push({
      key: 'progress',
      label: t('components.message.tool.progressCard.currentProgress'),
      value: props.card.currentProgress
    })
  }

  if (typeof props.card.milestonesTotal === 'number') {
    items.push({
      key: 'milestones',
      label: t('components.message.tool.progressCard.milestones'),
      value: `${props.card.milestonesCompleted || 0}/${props.card.milestonesTotal}`
    })
  }

  if (typeof props.card.todosTotal === 'number') {
    items.push({
      key: 'todos',
      label: t('components.message.tool.progressCard.todos'),
      value: `${props.card.todosCompleted || 0}/${props.card.todosTotal} · ${t('components.message.tool.todoPanel.statusInProgress')} ${props.card.todosInProgress || 0}`
    })
  }

  if (typeof props.card.activeRisks === 'number') {
    items.push({
      key: 'activeRisks',
      label: t('components.message.tool.progressCard.activeRisks'),
      value: String(props.card.activeRisks)
    })
  }

  const validationLabel = getValidationLabel(props.card)
  if (validationLabel || typeof props.card.issueCount === 'number') {
    items.push({
      key: 'validation',
      label: t('components.message.tool.progressCard.validation'),
      value: typeof props.card.issueCount === 'number'
        ? t('components.message.tool.progressCard.issueSummary', { count: props.card.issueCount, errors: props.card.errorCount || 0, warnings: props.card.warningCount || 0 })
        : validationLabel
    })
  }

  if (props.card.updatedAt) {
    items.push({
      key: 'updatedAt',
      label: t('components.message.tool.progressCard.updatedAt'),
      value: props.card.updatedAt
    })
  }

  return items
})

const artifactTags = computed(() => {
  const items: Array<{ key: string; label: string; value: string }> = []
  if (props.card.activeDesignPath) {
    items.push({
      key: 'design',
      label: t('components.message.tool.progressCard.activeDesign'),
      value: props.card.activeDesignPath
    })
  }
  if (props.card.activePlanPath) {
    items.push({
      key: 'plan',
      label: t('components.message.tool.progressCard.activePlan'),
      value: props.card.activePlanPath
    })
  }
  if (props.card.activeReviewPath) {
    items.push({
      key: 'review',
      label: t('components.message.tool.progressCard.activeReview'),
      value: props.card.activeReviewPath
    })
  }
  return items
})

const showRawContent = computed(() => props.showRawResult && (props.content || '').trim().length > 0)

async function openProgressFile(): Promise<void> {
  if (!props.card.path) return

  try {
    await sendToExtension('openWorkspaceFileAt', {
      path: props.card.path,
      highlight: false,
      preview: false
    })
  } catch (error) {
    console.error('[progress-card] Failed to open progress file:', error)
    await showNotification(t('components.message.tool.progressCard.openFileFailed'), 'error')
  }
}

async function copyProgressPath(): Promise<void> {
  if (!props.card.path) return

  const success = await copyToClipboard(props.card.path)
  if (!success) {
    await showNotification(t('components.message.tool.progressCard.copyFailed'), 'error')
    return
  }

  copied.value = true
  if (copyResetTimer) clearTimeout(copyResetTimer)
  copyResetTimer = setTimeout(() => {
    copied.value = false
    copyResetTimer = undefined
  }, 1500)
}

onBeforeUnmount(() => {
  if (copyResetTimer) {
    clearTimeout(copyResetTimer)
    copyResetTimer = undefined
  }
})
</script>

<template>
  <TaskCard
    :title="title"
    :subtitle="subtitle"
    :icon="getCardIcon(card.sourceTool)"
    :status="status"
    :preview="preview"
    :preview-is-markdown="false"
    :meta-chips="metaChips"
    :footer-right="footerRight"
    :default-expanded="props.defaultExpanded"
  >
    <template #expanded>
      <div class="progress-card-expanded">
        <div class="progress-card-actions">
          <button
            class="progress-card-btn"
            :disabled="!card.path"
            @click="openProgressFile"
          >
            <span class="codicon codicon-go-to-file"></span>
            <span>{{ t('components.message.tool.progressCard.openFile') }}</span>
          </button>
          <button
            class="progress-card-btn secondary"
            :disabled="!card.path"
            @click="copyProgressPath"
          >
            <span class="codicon codicon-copy"></span>
            <span>{{ copied ? t('components.message.tool.progressCard.copied') : t('components.message.tool.progressCard.copyPath') }}</span>
          </button>
        </div>

        <div v-if="summaryItems.length > 0" class="progress-summary-grid">
          <div
            v-for="item in summaryItems"
            :key="item.key"
            class="progress-summary-item"
          >
            <div class="progress-summary-label">{{ item.label }}</div>
            <div class="progress-summary-value">{{ item.value }}</div>
          </div>
        </div>

        <div v-if="artifactTags.length > 0" class="progress-block">
          <div class="progress-label">{{ t('components.message.tool.progressCard.activeArtifacts') }}</div>
          <div class="progress-artifact-tags">
            <span v-for="artifact in artifactTags" :key="artifact.key" class="progress-artifact-tag">
              <strong>{{ artifact.label }}</strong>
              <span>{{ artifact.value }}</span>
            </span>
          </div>
        </div>

        <div v-if="card.latestMilestoneId || card.latestMilestoneTitle" class="progress-block">
          <div class="progress-label">{{ t('components.message.tool.progressCard.latestMilestone') }}</div>
          <div class="progress-latest-milestone">
            <div class="progress-latest-milestone-title">
              {{ card.latestMilestoneId || '' }}<span v-if="card.latestMilestoneTitle"> · {{ card.latestMilestoneTitle }}</span>
            </div>
            <div class="progress-latest-milestone-meta">
              <span v-if="getMilestoneStatusLabel(card.latestMilestoneStatus)" class="progress-meta-chip">
                {{ getMilestoneStatusLabel(card.latestMilestoneStatus) }}
              </span>
              <span v-if="card.latestMilestoneRecordedAt" class="progress-meta-chip">
                {{ card.latestMilestoneRecordedAt }}
              </span>
            </div>
          </div>
        </div>

        <div v-if="card.latestConclusion" class="progress-block">
          <div class="progress-label">{{ t('components.message.tool.progressCard.latestConclusion') }}</div>
          <div class="progress-rich-content">
            <MarkdownRenderer :content="card.latestConclusion" render-profile="artifactSafe" />
          </div>
        </div>

        <div v-if="card.currentBlocker" class="progress-block">
          <div class="progress-label">{{ t('components.message.tool.progressCard.currentBlocker') }}</div>
          <div class="progress-rich-content">
            <MarkdownRenderer :content="card.currentBlocker" render-profile="artifactSafe" />
          </div>
        </div>

        <div v-if="card.nextAction" class="progress-block">
          <div class="progress-label">{{ t('components.message.tool.progressCard.nextAction') }}</div>
          <div class="progress-rich-content">
            <MarkdownRenderer :content="card.nextAction" render-profile="artifactSafe" />
          </div>
        </div>

        <div v-if="props.warnings && props.warnings.length > 0" class="progress-block">
          <div v-for="(warning, index) in props.warnings" :key="`warning-${index}`" class="progress-warning-item">
            <span class="codicon codicon-warning progress-warning-icon"></span>
            <span class="progress-warning-text">{{ warning }}</span>
          </div>
        </div>

        <div v-if="props.error" class="progress-block">
          <div class="progress-label">{{ t('components.message.tool.error') }}</div>
          <div class="progress-error-box">{{ props.error }}</div>
        </div>

        <div v-if="card.issues && card.issues.length > 0" class="progress-block">
          <div class="progress-label">{{ t('components.message.tool.progressCard.validation') }}</div>
          <ul class="progress-issues">
            <li v-for="(issue, index) in card.issues" :key="`${issue.code || 'issue'}-${index}`" class="progress-issue-item">
              <span :class="['progress-issue-badge', issue.severity || 'warning']">{{ getIssueSeverityLabel(issue.severity) }}</span>
              <span class="progress-issue-text">{{ issue.message }}</span>
            </li>
          </ul>
        </div>

        <div v-if="showRawContent" class="progress-block">
          <div class="progress-label">{{ t('components.message.tool.progressCard.rawResult') }}</div>
          <div class="progress-raw-result">
            <MarkdownRenderer :content="props.content" render-profile="artifactSafe" />
          </div>
        </div>
      </div>
    </template>
  </TaskCard>
</template>

<style scoped>
.progress-card-expanded {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.progress-card-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.progress-card-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  cursor: pointer;
  font-size: 11px;
}

.progress-card-btn:hover:not(:disabled) {
  background: var(--vscode-button-hoverBackground);
}

.progress-card-btn.secondary {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}

.progress-card-btn.secondary:hover:not(:disabled) {
  background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground));
}

.progress-card-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.progress-summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 8px;
}

.progress-summary-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  background: var(--vscode-sideBar-background);
}

.progress-summary-label {
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--vscode-descriptionForeground);
}

.progress-summary-value {
  font-size: 12px;
  line-height: 1.5;
  color: var(--vscode-foreground);
  word-break: break-word;
}

.progress-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.progress-label {
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--vscode-descriptionForeground);
}

.progress-artifact-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.progress-artifact-tag,
.progress-meta-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 999px;
  border: 1px solid var(--vscode-panel-border);
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  font-size: 11px;
  line-height: 1.4;
  max-width: 100%;
  word-break: break-word;
}

.progress-latest-milestone {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  background: var(--vscode-sideBar-background);
}

.progress-latest-milestone-title {
  font-size: 12px;
  line-height: 1.5;
  color: var(--vscode-foreground);
  font-weight: 600;
}

.progress-latest-milestone-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.progress-rich-content,
.progress-raw-result {
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  background: var(--vscode-sideBar-background);
  overflow: hidden;
}

.progress-rich-content :deep(.markdown-content),
.progress-raw-result :deep(.markdown-content) {
  padding: 8px 10px;
}

.progress-rich-content :deep(.markdown-content > :first-child),
.progress-raw-result :deep(.markdown-content > :first-child) {
  margin-top: 0;
}

.progress-rich-content :deep(.markdown-content > :last-child),
.progress-raw-result :deep(.markdown-content > :last-child) {
  margin-bottom: 0;
}

.progress-issues {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.progress-issue-item {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 8px 10px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  background: var(--vscode-sideBar-background);
}

.progress-issue-badge {
  flex-shrink: 0;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 10px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
}

.progress-issue-badge.error {
  background: var(--vscode-inputValidation-errorBackground);
  color: var(--vscode-errorForeground);
}

.progress-issue-badge.warning {
  background: var(--vscode-inputValidation-warningBackground);
  color: var(--vscode-editorWarning-foreground);
}

.progress-issue-text {
  font-size: 12px;
  line-height: 1.5;
  color: var(--vscode-foreground);
}

.progress-warning-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-panel-border));
  border-radius: 8px;
  background: var(--vscode-inputValidation-warningBackground, var(--vscode-sideBar-background));
}

.progress-warning-icon {
  color: var(--vscode-editorWarning-foreground);
  flex-shrink: 0;
}

.progress-warning-text {
  font-size: 12px;
  line-height: 1.5;
  color: var(--vscode-foreground);
  word-break: break-word;
}

.progress-error-box {
  padding: 8px 10px;
  border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-panel-border));
  border-radius: 8px;
  background: var(--vscode-inputValidation-errorBackground, var(--vscode-sideBar-background));
  color: var(--vscode-errorForeground);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
