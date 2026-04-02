<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from '../../i18n'
import { TaskCard, MarkdownRenderer, CustomScrollbar } from '../common'
import type {
  ReviewCardData,
  ReviewCardFindingDiffItem,
  ReviewCardFindingItem,
  ReviewCardTrackingStatus
} from '../../utils/reviewCards'
import { copyToClipboard } from '../../utils/format'
import { sendToExtension, showNotification } from '../../utils/vscode'

const props = withDefaults(defineProps<{
  card: ReviewCardData
  content?: string
  status?: 'pending' | 'running' | 'success' | 'error'
  defaultExpanded?: boolean
  showRawResult?: boolean
  planGenerationEnabled?: boolean
  planGenerationCompleted?: boolean
  isGeneratingPlan?: boolean
}>(), {
  content: '',
  status: 'success',
  defaultExpanded: false,
  showRawResult: true,
  planGenerationEnabled: false,
  planGenerationCompleted: false,
  isGeneratingPlan: false
})

const emit = defineEmits<{
  (e: 'generate-plan'): void
}>()

const { t } = useI18n()

const copied = ref(false)
let copyResetTimer: ReturnType<typeof setTimeout> | undefined

function getFallbackTitleByTool(sourceTool: ReviewCardData['sourceTool']): string {
  switch (sourceTool) {
    case 'create_review':
      return t('components.message.tool.createReview.fallbackTitle')
    case 'record_review_milestone':
      return t('components.message.tool.recordReviewMilestone.fallbackTitle')
    case 'finalize_review':
      return t('components.message.tool.finalizeReview.fallbackTitle')
    case 'reopen_review':
      return t('components.message.tool.reopenReview.fallbackTitle')
    case 'validate_review_document':
      return t('components.message.tool.validateReviewDocument.fallbackTitle')
    case 'compare_review_documents':
      return t('components.message.tool.compareReviewDocuments.fallbackTitle')
  }
}

function getSourceToolLabel(sourceTool: ReviewCardData['sourceTool']): string {
  switch (sourceTool) {
    case 'create_review':
      return t('components.message.tool.reviewCard.sourceCreate')
    case 'record_review_milestone':
      return t('components.message.tool.reviewCard.sourceMilestone')
    case 'finalize_review':
      return t('components.message.tool.reviewCard.sourceFinalize')
    case 'reopen_review':
      return t('components.message.tool.reviewCard.sourceReopen')
    case 'validate_review_document':
      return t('components.message.tool.reviewCard.sourceValidate')
    case 'compare_review_documents':
      return t('components.message.tool.reviewCard.sourceCompare')
  }
}

function getCardIcon(sourceTool: ReviewCardData['sourceTool']): string {
  switch (sourceTool) {
    case 'create_review':
      return 'codicon-eye'
    case 'record_review_milestone':
      return 'codicon-list-unordered'
    case 'finalize_review':
      return 'codicon-check-all'
    case 'reopen_review':
      return 'codicon-refresh'
    case 'validate_review_document':
      return 'codicon-verified'
    case 'compare_review_documents':
      return 'codicon-git-compare'
  }
}

function getReviewStatusLabel(status?: ReviewCardData['status']): string {
  if (status === 'completed') return t('components.message.tool.reviewCard.statusCompleted')
  if (status === 'in_progress') return t('components.message.tool.reviewCard.statusInProgress')
  return ''
}

function getOverallDecisionLabel(decision?: ReviewCardData['overallDecision']): string {
  if (decision === 'accepted') return t('components.message.tool.reviewCard.decisionAccepted')
  if (decision === 'conditionally_accepted') return t('components.message.tool.reviewCard.decisionConditionallyAccepted')
  if (decision === 'rejected') return t('components.message.tool.reviewCard.decisionRejected')
  if (decision === 'needs_follow_up') return t('components.message.tool.reviewCard.decisionNeedsFollowUp')
  return ''
}

function getValidationLabel(card: ReviewCardData): string {
  if (card.canAutoUpgrade) return t('components.message.tool.reviewCard.validationAutoUpgrade')
  if (card.isValid === false) return t('components.message.tool.reviewCard.validationInvalid')
  if ((card.warningCount || 0) > 0) return t('components.message.tool.reviewCard.validationWarning')
  if (card.isValid === true) return t('components.message.tool.reviewCard.validationValid')
  return ''
}

function getIssueSeverityLabel(severity?: 'error' | 'warning'): string {
  return severity === 'error'
    ? t('components.message.tool.reviewCard.issueError')
    : t('components.message.tool.reviewCard.issueWarning')
}

function getTrackingStatusLabel(status: ReviewCardTrackingStatus): string {
  switch (status) {
    case 'accepted_risk':
      return t('components.message.tool.reviewCard.trackingAcceptedRisk')
    case 'fixed':
      return t('components.message.tool.reviewCard.trackingFixed')
    case 'wont_fix':
      return t('components.message.tool.reviewCard.trackingWontFix')
    case 'duplicate':
      return t('components.message.tool.reviewCard.trackingDuplicate')
    default:
      return t('components.message.tool.reviewCard.trackingOpen')
  }
}

function getSeverityLabel(severity?: ReviewCardFindingItem['severity']): string {
  if (severity === 'high') return t('components.message.tool.reviewCard.severityHigh')
  if (severity === 'medium') return t('components.message.tool.reviewCard.severityMedium')
  if (severity === 'low') return t('components.message.tool.reviewCard.severityLow')
  return ''
}

function getCategoryLabel(category?: ReviewCardFindingItem['category']): string {
  switch (category) {
    case 'html':
      return t('components.message.tool.reviewCard.categoryHtml')
    case 'css':
      return t('components.message.tool.reviewCard.categoryCss')
    case 'javascript':
      return t('components.message.tool.reviewCard.categoryJavascript')
    case 'accessibility':
      return t('components.message.tool.reviewCard.categoryAccessibility')
    case 'performance':
      return t('components.message.tool.reviewCard.categoryPerformance')
    case 'maintainability':
      return t('components.message.tool.reviewCard.categoryMaintainability')
    case 'docs':
      return t('components.message.tool.reviewCard.categoryDocs')
    case 'test':
      return t('components.message.tool.reviewCard.categoryTest')
    case 'other':
      return t('components.message.tool.reviewCard.categoryOther')
    default:
      return category || ''
  }
}

function getCompareChangeLabel(change: string): string {
  switch (change) {
    case 'severity':
      return t('components.message.tool.reviewCard.changeSeverity')
    case 'trackingStatus':
      return t('components.message.tool.reviewCard.changeTrackingStatus')
    case 'title':
      return t('components.message.tool.reviewCard.changeTitle')
    case 'description':
      return t('components.message.tool.reviewCard.changeDescription')
    case 'recommendation':
      return t('components.message.tool.reviewCard.changeRecommendation')
    case 'evidence':
      return t('components.message.tool.reviewCard.changeEvidence')
    case 'relatedMilestoneIds':
      return t('components.message.tool.reviewCard.changeRelatedMilestoneIds')
    default:
      return change
  }
}

function formatCompareEndpoint(title?: string, date?: string, path?: string): string {
  const parts = [title, date, path].filter(Boolean)
  return parts.join(' · ')
}

type ReviewSummaryTone = 'neutral' | 'success' | 'warning' | 'error'
type ReviewSummaryItem = {
  key: string
  label: string
  value: string
  tone?: ReviewSummaryTone
}

function getStatusTone(status?: ReviewCardData['status']): ReviewSummaryTone {
  return status === 'completed' ? 'success' : 'neutral'
}

function getDecisionTone(decision?: ReviewCardData['overallDecision']): ReviewSummaryTone {
  if (decision === 'accepted') return 'success'
  if (decision === 'rejected') return 'error'
  if (decision === 'conditionally_accepted' || decision === 'needs_follow_up') return 'warning'
  return 'neutral'
}

function getValidationTone(card: ReviewCardData): ReviewSummaryTone {
  if (card.isValid === false) return 'error'
  if (card.canAutoUpgrade || (card.warningCount || 0) > 0) return 'warning'
  if (card.isValid === true) return 'success'
  return 'neutral'
}

const title = computed(() => props.card.title || getFallbackTitleByTool(props.card.sourceTool))
const isCompareCard = computed(() => props.card.sourceTool === 'compare_review_documents')
const findingItems = computed(() => props.card.findingItems || [])
const compareAddedFindings = computed(() => props.card.compareAddedFindings || [])
const compareRemovedFindings = computed(() => props.card.compareRemovedFindings || [])
const comparePersistedFindings = computed(() => props.card.comparePersistedFindings || [])
const compareBaseLabel = computed(() => formatCompareEndpoint(props.card.compareBaseTitle, props.card.compareBaseDate, props.card.compareBasePath))
const compareTargetLabel = computed(() => formatCompareEndpoint(props.card.compareTargetTitle, props.card.compareTargetDate, props.card.compareTargetPath))

const subtitle = computed(() => props.card.path || undefined)
const footerRight = computed(() => {
  const parts = [getSourceToolLabel(props.card.sourceTool), props.card.date || ''].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : undefined
})

const metaChips = computed(() => {
  const chips: string[] = []

  if (isCompareCard.value) {
    if (typeof props.card.compareAddedCount === 'number') chips.push(`${t('components.message.tool.reviewCard.compareAdded')} ${props.card.compareAddedCount}`)
    if (typeof props.card.compareRemovedCount === 'number') chips.push(`${t('components.message.tool.reviewCard.compareRemoved')} ${props.card.compareRemovedCount}`)
    if (typeof props.card.comparePersistedCount === 'number') chips.push(`${t('components.message.tool.reviewCard.comparePersisted')} ${props.card.comparePersistedCount}`)
    if (typeof props.card.compareSeverityChangedCount === 'number' && props.card.compareSeverityChangedCount > 0) {
      chips.push(`${t('components.message.tool.reviewCard.compareSeverityChanged')} ${props.card.compareSeverityChangedCount}`)
    }
    if (typeof props.card.compareTrackingChangedCount === 'number' && props.card.compareTrackingChangedCount > 0) {
      chips.push(`${t('components.message.tool.reviewCard.compareTrackingChanged')} ${props.card.compareTrackingChangedCount}`)
    }
    return chips
  }

  const statusLabel = getReviewStatusLabel(props.card.status)
  if (statusLabel) chips.push(statusLabel)

  const decisionLabel = getOverallDecisionLabel(props.card.overallDecision)
  if (decisionLabel) chips.push(decisionLabel)

  if (
    typeof props.card.completedMilestones === 'number'
    && typeof props.card.totalMilestones === 'number'
  ) {
    chips.push(t('components.message.tool.reviewCard.milestonesChip', {
      completed: props.card.completedMilestones,
      total: props.card.totalMilestones
    }))
  }

  if (typeof props.card.totalFindings === 'number') {
    chips.push(t('components.message.tool.reviewCard.findingsChip', {
      total: props.card.totalFindings,
      high: props.card.highCount || 0,
      medium: props.card.mediumCount || 0,
      low: props.card.lowCount || 0
    }))
  }

  if (trackingSummary.value) {
    chips.push(trackingSummary.value)
  }

  if ((props.card.reviewedModulesCount || 0) > 0) {
    chips.push(t('components.message.tool.reviewCard.modulesChip', {
      count: props.card.reviewedModulesCount || 0
    }))
  }

  const validationLabel = getValidationLabel(props.card)
  if (validationLabel) chips.push(validationLabel)

  if (props.card.sourceTool === 'validate_review_document' && props.card.detectedFormat) {
    chips.push(t('components.message.tool.reviewCard.formatChip', {
      format: props.card.detectedFormat
    }))
  }

  return chips
})

const preview = computed(() => {
  const blocks: string[] = []

  if (isCompareCard.value) {
    if (compareBaseLabel.value) {
      blocks.push([t('components.message.tool.reviewCard.compareBase'), compareBaseLabel.value].join('\n'))
    }
    if (compareTargetLabel.value) {
      blocks.push([t('components.message.tool.reviewCard.compareTarget'), compareTargetLabel.value].join('\n'))
    }
    blocks.push([
      t('components.message.tool.reviewCard.compareChanges'),
      metaChips.value.join(' · ')
    ].join('\n'))
    return blocks.filter(Boolean).join('\n\n')
  }

  if (props.card.latestConclusionPreview) {
    blocks.push([
      t('components.message.tool.reviewCard.latestConclusion'),
      props.card.latestConclusionPreview
    ].join('\n'))
  }

  if (props.card.recommendedNextActionPreview) {
    blocks.push([
      t('components.message.tool.reviewCard.recommendedNextAction'),
      props.card.recommendedNextActionPreview
    ].join('\n'))
  }

  if (blocks.length === 0) {
    const validationLabel = getValidationLabel(props.card)
    if (validationLabel) {
      blocks.push([
        t('components.message.tool.reviewCard.validation'),
        validationIssueSummary.value || validationLabel
      ].join('\n'))
    }
  }

  return blocks.join('\n\n')
})

const rawContent = computed(() => (props.content || '').trim())
const showRawContent = computed(() => props.showRawResult && rawContent.value.length > 0)
const rawContentIsMarkdown = computed(() => props.card.sourceTool !== 'validate_review_document')

const validationIssueSummary = computed(() => {
  if (
    props.card.issueCount === undefined
    && props.card.errorCount === undefined
    && props.card.warningCount === undefined
  ) {
    return ''
  }

  if ((props.card.issueCount || 0) === 0) {
    return t('components.message.tool.reviewCard.noIssues')
  }

  return t('components.message.tool.reviewCard.issueSummary', {
    count: props.card.issueCount || 0,
    errors: props.card.errorCount || 0,
    warnings: props.card.warningCount || 0
  })
})

const milestonesSummary = computed(() => {
  if (
    typeof props.card.completedMilestones === 'number'
    && typeof props.card.totalMilestones === 'number'
  ) {
    return `${props.card.completedMilestones}/${props.card.totalMilestones}`
  }

  return ''
})

const findingsSummary = computed(() => {
  if (typeof props.card.totalFindings !== 'number') {
    return ''
  }

  return t('components.message.tool.reviewCard.findingsChip', {
    total: props.card.totalFindings,
    high: props.card.highCount || 0,
    medium: props.card.mediumCount || 0,
    low: props.card.lowCount || 0
  })
})

const trackingItems = computed(() => {
  const items: Array<{ key: ReviewCardTrackingStatus; label: string; count: number }> = []
  const definitions: Array<{ key: ReviewCardTrackingStatus; count: number | undefined }> = [
    { key: 'open', count: props.card.openTrackingCount },
    { key: 'accepted_risk', count: props.card.acceptedRiskTrackingCount },
    { key: 'fixed', count: props.card.fixedTrackingCount },
    { key: 'wont_fix', count: props.card.wontFixTrackingCount },
    { key: 'duplicate', count: props.card.duplicateTrackingCount }
  ]

  for (const definition of definitions) {
    if ((definition.count || 0) <= 0) continue
    items.push({
      key: definition.key,
      label: getTrackingStatusLabel(definition.key),
      count: definition.count || 0
    })
  }

  return items
})

const trackingSummary = computed(() => trackingItems.value.map((item) => `${item.label} ${item.count}`).join(' · '))

const summaryItems = computed<ReviewSummaryItem[]>(() => {
  const items: ReviewSummaryItem[] = []

  if (isCompareCard.value) {
    items.push({ key: 'added', label: t('components.message.tool.reviewCard.compareAdded'), value: String(props.card.compareAddedCount || 0) })
    items.push({ key: 'removed', label: t('components.message.tool.reviewCard.compareRemoved'), value: String(props.card.compareRemovedCount || 0) })
    items.push({ key: 'persisted', label: t('components.message.tool.reviewCard.comparePersisted'), value: String(props.card.comparePersistedCount || 0) })
    items.push({ key: 'severityChanged', label: t('components.message.tool.reviewCard.compareSeverityChanged'), value: String(props.card.compareSeverityChangedCount || 0) })
    items.push({ key: 'trackingChanged', label: t('components.message.tool.reviewCard.compareTrackingChanged'), value: String(props.card.compareTrackingChangedCount || 0) })
    if (typeof props.card.compareEvidenceChangedCount === 'number') {
      items.push({ key: 'evidenceChanged', label: t('components.message.tool.reviewCard.compareEvidenceChanged'), value: String(props.card.compareEvidenceChangedCount || 0) })
    }
    if (typeof props.card.compareRelatedMilestoneChangedCount === 'number') {
      items.push({ key: 'relatedMilestoneChanged', label: t('components.message.tool.reviewCard.compareRelatedMilestonesChanged'), value: String(props.card.compareRelatedMilestoneChangedCount || 0) })
    }
    return items
  }

  const statusLabel = getReviewStatusLabel(props.card.status)
  if (statusLabel) {
    items.push({
      key: 'status',
      label: t('components.message.tool.reviewCard.status'),
      value: statusLabel,
      tone: getStatusTone(props.card.status)
    })
  }

  const decisionLabel = getOverallDecisionLabel(props.card.overallDecision)
  if (decisionLabel) {
    items.push({
      key: 'decision',
      label: t('components.message.tool.reviewCard.decision'),
      value: decisionLabel,
      tone: getDecisionTone(props.card.overallDecision)
    })
  }

  if (props.card.currentProgress) {
    items.push({
      key: 'progress',
      label: t('components.message.tool.reviewCard.progress'),
      value: props.card.currentProgress
    })
  }

  if (milestonesSummary.value) {
    items.push({
      key: 'milestones',
      label: t('components.message.tool.reviewCard.milestones'),
      value: milestonesSummary.value
    })
  }

  if (findingsSummary.value) {
    items.push({
      key: 'findings',
      label: t('components.message.tool.reviewCard.findings'),
      value: findingsSummary.value
    })
  }

  if (trackingSummary.value) {
    items.push({
      key: 'tracking',
      label: t('components.message.tool.reviewCard.tracking'),
      value: trackingSummary.value
    })
  }

  const validationLabel = getValidationLabel(props.card)
  if (validationLabel || validationIssueSummary.value) {
    items.push({
      key: 'validation',
      label: t('components.message.tool.reviewCard.validation'),
      value: validationIssueSummary.value || validationLabel,
      tone: getValidationTone(props.card)
    })
  }

  if (props.card.sourceTool === 'validate_review_document' && props.card.detectedFormat) {
    items.push({
      key: 'format',
      label: t('components.message.tool.reviewCard.format'),
      value: props.card.detectedFormat
    })
  }

  return items
})

const moduleTags = computed(() => props.card.reviewedModules || [])

function getFindingMetaChips(item: ReviewCardFindingItem): string[] {
  const chips: string[] = []
  const severity = getSeverityLabel(item.severity)
  if (severity) chips.push(severity)
  const category = getCategoryLabel(item.category)
  if (category) chips.push(category)
  if (item.trackingStatus) chips.push(getTrackingStatusLabel(item.trackingStatus))
  return chips
}

function getFindingDiffPreview(item: ReviewCardFindingDiffItem): string {
  return item.changes.map(change => getCompareChangeLabel(change)).join(' · ')
}

function handleGeneratePlan(): void {
  if (!props.planGenerationEnabled || props.isGeneratingPlan) return
  emit('generate-plan')
}

const showPlanAction = computed(() => props.planGenerationEnabled || props.planGenerationCompleted || props.isGeneratingPlan)
const planActionDisabled = computed(() => !props.planGenerationEnabled || props.isGeneratingPlan)

async function openReviewFile(): Promise<void> {
  if (!props.card.path) return

  try {
    await sendToExtension('openWorkspaceFileAt', {
      path: props.card.path,
      highlight: false,
      preview: false
    })
  } catch (error) {
    console.error('[review-card] Failed to open review file:', error)
    await showNotification(t('components.message.tool.reviewCard.openFileFailed'), 'error')
  }
}

async function copyReviewPath(): Promise<void> {
  if (!props.card.path) return

  const success = await copyToClipboard(props.card.path)
  if (!success) {
    await showNotification(t('components.message.tool.reviewCard.copyFailed'), 'error')
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
      <div class="review-card-expanded">
        <div class="review-card-actions">
          <button
            class="review-card-btn"
            :disabled="!card.path"
            @click="openReviewFile"
          >
            <span class="codicon codicon-go-to-file"></span>
            <span>{{ t('components.message.tool.reviewCard.openFile') }}</span>
          </button>
          <button
            class="review-card-btn secondary"
            :disabled="!card.path"
            @click="copyReviewPath"
          >
            <span class="codicon codicon-copy"></span>
            <span>{{ copied ? t('components.message.tool.reviewCard.copied') : t('components.message.tool.reviewCard.copyPath') }}</span>
          </button>
          <button
            v-if="showPlanAction"
            class="review-card-btn secondary"
            :disabled="planActionDisabled"
            @click="handleGeneratePlan"
          >
            <span :class="['codicon', props.isGeneratingPlan ? 'codicon-loading codicon-modifier-spin' : (props.planGenerationCompleted ? 'codicon-check' : 'codicon-arrow-right')]"></span>
            <span>{{ props.isGeneratingPlan ? t('components.message.tool.reviewCard.generatingPlan') : (props.planGenerationCompleted ? t('components.message.tool.reviewCard.planGenerated') : t('components.message.tool.reviewCard.generatePlan')) }}</span>
          </button>
        </div>

        <div v-if="isCompareCard && (compareBaseLabel || compareTargetLabel)" class="review-block">
          <div v-if="compareBaseLabel" class="review-compare-endpoint">
            <div class="review-label">{{ t('components.message.tool.reviewCard.compareBase') }}</div>
            <div class="review-compare-endpoint-value">{{ compareBaseLabel }}</div>
          </div>
          <div v-if="compareTargetLabel" class="review-compare-endpoint">
            <div class="review-label">{{ t('components.message.tool.reviewCard.compareTarget') }}</div>
            <div class="review-compare-endpoint-value">{{ compareTargetLabel }}</div>
          </div>
        </div>


        <div v-if="summaryItems.length > 0" class="review-summary-grid">
          <div
            v-for="item in summaryItems"
            :key="item.key"
            :class="['review-summary-item', item.tone ? `tone-${item.tone}` : '']"
          >
            <div class="review-summary-label">{{ item.label }}</div>
            <div class="review-summary-value">{{ item.value }}</div>
          </div>
        </div>

        <div v-if="moduleTags.length > 0" class="review-block">
          <div class="review-label">{{ t('components.message.tool.reviewCard.modules') }}</div>
          <div class="review-module-tags">
            <span v-for="moduleName in moduleTags" :key="moduleName" class="review-module-tag">
              {{ moduleName }}
            </span>
          </div>
        </div>

        <div v-if="trackingItems.length > 0" class="review-block">
          <div class="review-label">{{ t('components.message.tool.reviewCard.tracking') }}</div>
          <div class="review-module-tags">
            <span v-for="item in trackingItems" :key="item.key" class="review-module-tag tracking">
              {{ item.label }} {{ item.count }}
            </span>
          </div>
        </div>

        <div v-if="!isCompareCard && findingItems.length > 0" class="review-block">
          <div class="review-label">{{ t('components.message.tool.reviewCard.findingDetails') }}</div>
          <ul class="review-finding-list">
            <li v-for="item in findingItems" :key="item.key" class="review-finding-item">
              <div class="review-finding-header">
                <div class="review-finding-title-row">
                  <div class="review-finding-title">{{ item.title }}</div>
                  <span v-if="item.id" class="review-module-tag finding-id">{{ item.id }}</span>
                </div>
                <div v-if="getFindingMetaChips(item).length > 0" class="review-module-tags">
                  <span v-for="chip in getFindingMetaChips(item)" :key="`${item.key}-${chip}`" class="review-module-tag finding-meta">{{ chip }}</span>
                </div>
              </div>
              <div v-if="item.description || item.recommendation || (item.relatedMilestoneIds && item.relatedMilestoneIds.length > 0)" class="review-finding-body">
                <div v-if="item.description" class="review-finding-rich">
                  <div class="review-inline-label">{{ t('components.message.tool.reviewCard.changeDescription') }}</div>
                  <div class="review-rich-content compact">
                    <MarkdownRenderer :content="item.description" />
                  </div>
                </div>
                <div v-if="item.recommendation" class="review-finding-rich">
                  <div class="review-inline-label">{{ t('components.message.tool.reviewCard.changeRecommendation') }}</div>
                  <div class="review-rich-content compact">
                    <MarkdownRenderer :content="item.recommendation" />
                  </div>
                </div>
                <div v-if="item.relatedMilestoneIds && item.relatedMilestoneIds.length > 0" class="review-detail-row">
                  <span class="review-detail-label">{{ t('components.message.tool.reviewCard.changeRelatedMilestoneIds') }}</span>
                  <span class="review-detail-value">{{ item.relatedMilestoneIds.join(', ') }}</span>
                </div>
              </div>
              <div v-if="item.evidence.length > 0" class="review-finding-evidence">
                <div class="review-inline-label">{{ t('components.message.tool.reviewCard.evidence') }}</div>
                <ul class="review-evidence-list">
                  <li v-for="evidence in item.evidence" :key="`${item.key}-${evidence.displayText}`" class="review-evidence-item">
                    {{ evidence.displayText }}
                  </li>
                </ul>
              </div>
            </li>
          </ul>
        </div>

        <div v-if="isCompareCard && compareAddedFindings.length > 0" class="review-block">
          <div class="review-label">{{ t('components.message.tool.reviewCard.compareAdded') }}</div>
          <ul class="review-finding-list">
            <li v-for="item in compareAddedFindings" :key="item.key" class="review-finding-item">
              <div class="review-finding-header">
                <div class="review-finding-title-row">
                  <div class="review-finding-title">{{ item.title }}</div>
                  <span v-if="item.id" class="review-module-tag finding-id">{{ item.id }}</span>
                </div>
                <div v-if="getFindingMetaChips(item).length > 0" class="review-module-tags">
                  <span v-for="chip in getFindingMetaChips(item)" :key="`${item.key}-${chip}`" class="review-module-tag finding-meta">{{ chip }}</span>
                </div>
              </div>
              <div v-if="item.description || item.recommendation || (item.relatedMilestoneIds && item.relatedMilestoneIds.length > 0)" class="review-finding-body">
                <div v-if="item.description" class="review-finding-rich">
                  <div class="review-inline-label">{{ t('components.message.tool.reviewCard.changeDescription') }}</div>
                  <div class="review-rich-content compact">
                    <MarkdownRenderer :content="item.description" />
                  </div>
                </div>
                <div v-if="item.recommendation" class="review-finding-rich">
                  <div class="review-inline-label">{{ t('components.message.tool.reviewCard.changeRecommendation') }}</div>
                  <div class="review-rich-content compact">
                    <MarkdownRenderer :content="item.recommendation" />
                  </div>
                </div>
                <div v-if="item.relatedMilestoneIds && item.relatedMilestoneIds.length > 0" class="review-detail-row">
                  <span class="review-detail-label">{{ t('components.message.tool.reviewCard.changeRelatedMilestoneIds') }}</span>
                  <span class="review-detail-value">{{ item.relatedMilestoneIds.join(', ') }}</span>
                </div>
              </div>
              <div v-if="item.evidence.length > 0" class="review-finding-evidence">
                <div class="review-inline-label">{{ t('components.message.tool.reviewCard.evidence') }}</div>
                <ul class="review-evidence-list">
                  <li v-for="evidence in item.evidence" :key="`${item.key}-${evidence.displayText}`" class="review-evidence-item">
                    {{ evidence.displayText }}
                  </li>
                </ul>
              </div>
            </li>
          </ul>
        </div>

        <div v-if="isCompareCard && compareRemovedFindings.length > 0" class="review-block">
          <div class="review-label">{{ t('components.message.tool.reviewCard.compareRemoved') }}</div>
          <ul class="review-finding-list">
            <li v-for="item in compareRemovedFindings" :key="item.key" class="review-finding-item">
              <div class="review-finding-header">
                <div class="review-finding-title-row">
                  <div class="review-finding-title">{{ item.title }}</div>
                  <span v-if="item.id" class="review-module-tag finding-id">{{ item.id }}</span>
                </div>
                <div v-if="getFindingMetaChips(item).length > 0" class="review-module-tags">
                  <span v-for="chip in getFindingMetaChips(item)" :key="`${item.key}-${chip}`" class="review-module-tag finding-meta">{{ chip }}</span>
                </div>
              </div>
              <div v-if="item.description || item.recommendation || (item.relatedMilestoneIds && item.relatedMilestoneIds.length > 0)" class="review-finding-body">
                <div v-if="item.description" class="review-finding-rich">
                  <div class="review-inline-label">{{ t('components.message.tool.reviewCard.changeDescription') }}</div>
                  <div class="review-rich-content compact">
                    <MarkdownRenderer :content="item.description" />
                  </div>
                </div>
                <div v-if="item.recommendation" class="review-finding-rich">
                  <div class="review-inline-label">{{ t('components.message.tool.reviewCard.changeRecommendation') }}</div>
                  <div class="review-rich-content compact">
                    <MarkdownRenderer :content="item.recommendation" />
                  </div>
                </div>
                <div v-if="item.relatedMilestoneIds && item.relatedMilestoneIds.length > 0" class="review-detail-row">
                  <span class="review-detail-label">{{ t('components.message.tool.reviewCard.changeRelatedMilestoneIds') }}</span>
                  <span class="review-detail-value">{{ item.relatedMilestoneIds.join(', ') }}</span>
                </div>
              </div>
              <div v-if="item.evidence.length > 0" class="review-finding-evidence">
                <div class="review-inline-label">{{ t('components.message.tool.reviewCard.evidence') }}</div>
                <ul class="review-evidence-list">
                  <li v-for="evidence in item.evidence" :key="`${item.key}-${evidence.displayText}`" class="review-evidence-item">{{ evidence.displayText }}</li>
                </ul>
              </div>
            </li>
          </ul>
        </div>

        <div v-if="card.latestConclusion" class="review-block">
          <div class="review-label">{{ t('components.message.tool.reviewCard.latestConclusion') }}</div>
          <div class="review-rich-content">
            <MarkdownRenderer :content="card.latestConclusion" />
          </div>
        </div>

        <div v-if="card.recommendedNextAction" class="review-block">
          <div class="review-label">{{ t('components.message.tool.reviewCard.recommendedNextAction') }}</div>
          <div class="review-rich-content">
            <MarkdownRenderer :content="card.recommendedNextAction" />
          </div>
        </div>

        <div v-if="card.issues && card.issues.length > 0" class="review-block">
          <div class="review-label">{{ t('components.message.tool.reviewCard.validation') }}</div>
          <ul class="review-issues">
            <li v-for="(issue, index) in card.issues" :key="`${issue.code || 'issue'}-${index}`" class="review-issue-item">
              <span :class="['review-issue-badge', issue.severity || 'warning']">{{ getIssueSeverityLabel(issue.severity) }}</span>
              <span class="review-issue-text">{{ issue.message }}</span>
            </li>
          </ul>
        </div>

        <div v-if="isCompareCard && comparePersistedFindings.length > 0" class="review-block">
          <div class="review-label">{{ t('components.message.tool.reviewCard.comparePersisted') }}</div>
          <ul class="review-finding-list">
            <li v-for="item in comparePersistedFindings" :key="item.key" class="review-finding-item">
              <div class="review-finding-title">{{ item.title }}</div>
              <div class="review-change-list">
                <span class="review-change-label">{{ t('components.message.tool.reviewCard.compareChanges') }}</span>
                <span class="review-change-value">{{ getFindingDiffPreview(item) }}</span>
              </div>
            </li>
          </ul>
        </div>

        <div v-if="showRawContent" class="review-block">
          <div class="review-label">{{ t('components.message.tool.reviewCard.rawResult') }}</div>
          <div class="review-raw-result">
            <CustomScrollbar :max-height="400">
              <div class="review-raw-result-inner">
                <MarkdownRenderer v-if="rawContentIsMarkdown" :content="rawContent" />
                <pre v-else class="review-raw-text">{{ rawContent }}</pre>
              </div>
            </CustomScrollbar>
          </div>
        </div>
      </div>
    </template>
  </TaskCard>
</template>

<style scoped>
.review-card-expanded {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.review-card-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.review-card-btn {
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

.review-card-btn:hover:not(:disabled) {
  background: var(--vscode-button-hoverBackground);
}

.review-card-btn.secondary {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}

.review-card-btn.secondary:hover:not(:disabled) {
  background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground));
}

.review-card-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.review-summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 8px;
}

.review-summary-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  background: var(--vscode-sideBar-background);
}

.review-summary-item.tone-success {
  border-color: var(--vscode-testing-iconPassed);
}

.review-summary-item.tone-warning {
  border-color: var(--vscode-editorWarning-foreground);
}

.review-summary-item.tone-error {
  border-color: var(--vscode-errorForeground);
}

.review-summary-label {
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--vscode-descriptionForeground);
}

.review-summary-value {
  font-size: 12px;
  line-height: 1.5;
  color: var(--vscode-foreground);
  word-break: break-word;
}

.review-module-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.review-module-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 999px;
  border: 1px solid var(--vscode-panel-border);
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  font-size: 11px;
  line-height: 1.4;
}

.review-module-tag.finding-id {
  font-family: var(--vscode-editor-font-family), monospace;
  background: var(--vscode-editorWidget-background, var(--vscode-badge-background));
  max-width: 100%;
  white-space: normal;
  word-break: break-all;
}

.review-module-tag.finding-meta {
  background: var(--vscode-editorInfo-background);
  color: var(--vscode-editorInfo-foreground);
}

.review-compare-endpoint {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  background: var(--vscode-sideBar-background);
}

.review-compare-endpoint-value {
  font-size: 12px;
  line-height: 1.5;
  color: var(--vscode-foreground);
  word-break: break-word;
}

.review-finding-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.review-finding-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  background: var(--vscode-sideBar-background);
}

.review-finding-header {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.review-finding-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.review-finding-title {
  font-size: 12px;
  line-height: 1.5;
  color: var(--vscode-foreground);
  font-weight: 600;
  flex: 1;
}

.review-evidence-list {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.review-evidence-item {
  font-size: 12px;
  line-height: 1.5;
  color: var(--vscode-foreground);
  word-break: break-word;
}

.review-finding-body,
.review-finding-evidence {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.review-inline-label,
.review-detail-label {
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--vscode-descriptionForeground);
}

.review-finding-rich {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.review-detail-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex-wrap: wrap;
}

.review-detail-value {
  font-size: 12px;
  line-height: 1.5;
  color: var(--vscode-foreground);
  word-break: break-word;
}

.review-change-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.review-change-label {
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--vscode-descriptionForeground);
}

.review-change-value {
  font-size: 12px;
  line-height: 1.5;
  color: var(--vscode-foreground);
  word-break: break-word;
}

.review-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.review-label {
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--vscode-descriptionForeground);
}

.review-rich-content,
.review-raw-result {
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  background: var(--vscode-sideBar-background);
  overflow: hidden;
}

.review-rich-content.compact {
  border-style: dashed;
}

.review-rich-content :deep(.markdown-content),
.review-raw-result-inner {
  padding: 8px 10px;
}

.review-rich-content :deep(.markdown-content > :first-child) {
  margin-top: 0;
}

.review-rich-content :deep(.markdown-content > :last-child) {
  margin-bottom: 0;
}

.review-issues {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.review-issue-item {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 8px 10px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  background: var(--vscode-sideBar-background);
}

.review-issue-badge {
  flex-shrink: 0;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 10px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
}

.review-issue-badge.error {
  background: var(--vscode-inputValidation-errorBackground);
  color: var(--vscode-errorForeground);
}

.review-issue-badge.warning {
  background: var(--vscode-inputValidation-warningBackground);
  color: var(--vscode-editorWarning-foreground);
}

.review-issue-text {
  font-size: 12px;
  line-height: 1.5;
  color: var(--vscode-foreground);
}

.review-raw-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.5;
  color: var(--vscode-foreground);
  font-family: var(--vscode-editor-font-family), monospace;
}
</style>
