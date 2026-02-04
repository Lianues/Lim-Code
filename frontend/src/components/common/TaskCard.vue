<script setup lang="ts">
import { computed, ref, useSlots } from 'vue'
import MarkdownRenderer from './MarkdownRenderer.vue'
import CustomScrollbar from './CustomScrollbar.vue'

type CardStatus = 'pending' | 'running' | 'success' | 'error'

const props = withDefaults(defineProps<{
  title: string
  subtitle?: string
  icon?: string // codicon class, e.g. "codicon-hubot"
  status?: CardStatus
  preview?: string
  previewIsMarkdown?: boolean
  metaChips?: string[]
  footerRight?: string
  defaultExpanded?: boolean
}>(), {
  previewIsMarkdown: true,
  metaChips: () => [],
  defaultExpanded: false
})

const slots = useSlots()
const expanded = ref(!!props.defaultExpanded)

function toggleExpanded() {
  expanded.value = !expanded.value
}

const hasExpanded = computed(() => !!slots.expanded)
const hasPreview = computed(() => !!(props.preview && props.preview.trim()))

const statusIcon = computed(() => {
  switch (props.status) {
    case 'success':
      return 'codicon-pass'
    case 'error':
      return 'codicon-error'
    case 'running':
      return 'codicon-loading codicon-modifier-spin'
    case 'pending':
      return 'codicon-clock'
    default:
      return ''
  }
})

const statusClass = computed(() => {
  switch (props.status) {
    case 'success':
      return 'is-success'
    case 'error':
      return 'is-error'
    case 'running':
      return 'is-running'
    case 'pending':
      return 'is-pending'
    default:
      return ''
  }
})
</script>

<template>
  <div class="task-card" :class="statusClass">
    <button
      class="card-header"
      type="button"
      :disabled="!hasExpanded"
      :title="hasExpanded ? '' : undefined"
      @click="hasExpanded && toggleExpanded()"
    >
      <div class="header-left">
        <i v-if="icon" :class="['codicon', icon, 'header-icon']"></i>
        <div class="header-text">
          <div class="header-title">{{ title }}</div>
          <div v-if="subtitle" class="header-subtitle">{{ subtitle }}</div>
        </div>
      </div>

      <div class="header-right">
        <span v-if="statusIcon" :class="['codicon', statusIcon, 'status-icon']"></span>
        <span v-if="hasExpanded" :class="['codicon', expanded ? 'codicon-chevron-down' : 'codicon-chevron-right', 'chevron']"></span>
      </div>
    </button>

    <div v-if="metaChips.length > 0" class="meta-row">
      <span v-for="(c, idx) in metaChips" :key="idx" class="chip">{{ c }}</span>
    </div>

    <div v-if="hasPreview" class="preview">
      <CustomScrollbar :horizontal="true" :max-height="160">
        <div class="preview-inner">
          <MarkdownRenderer v-if="previewIsMarkdown" :content="preview!" />
          <pre v-else class="preview-text">{{ preview }}</pre>
        </div>
      </CustomScrollbar>
    </div>

    <Transition name="task-expand">
      <div v-if="hasExpanded && expanded" class="expanded">
        <slot name="expanded"></slot>
      </div>
    </Transition>

    <div v-if="footerRight" class="footer">
      <div class="footer-spacer"></div>
      <div class="footer-right">{{ footerRight }}</div>
    </div>
  </div>
</template>

<style scoped>
.task-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 10px 8px;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 10px;
  overflow: hidden;
}

.task-card.is-success { border-left: 3px solid var(--vscode-testing-iconPassed); }
.task-card.is-error { border-left: 3px solid var(--vscode-testing-iconFailed); }
.task-card.is-running { border-left: 3px solid var(--vscode-charts-blue); }
.task-card.is-pending { border-left: 3px solid var(--vscode-charts-orange); }

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  padding: 0;
  margin: 0;
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.card-header:disabled {
  cursor: default;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.header-icon {
  font-size: 14px;
  color: var(--vscode-foreground);
  opacity: 0.9;
  flex-shrink: 0;
}

.header-text {
  min-width: 0;
  flex: 1;
}

.header-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--vscode-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-subtitle {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.status-icon {
  font-size: 14px;
  color: var(--vscode-descriptionForeground);
}

.task-card.is-success .status-icon { color: var(--vscode-testing-iconPassed); }
.task-card.is-error .status-icon { color: var(--vscode-testing-iconFailed); }
.task-card.is-running .status-icon { color: var(--vscode-charts-blue); }
.task-card.is-pending .status-icon { color: var(--vscode-charts-orange); }

.chevron {
  font-size: 14px;
  color: var(--vscode-descriptionForeground);
  opacity: 0.9;
}

.meta-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.chip {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  white-space: nowrap;
}

.preview {
  background: var(--vscode-sideBar-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  overflow: hidden;
}

.preview-inner {
  padding: 8px 10px;
}

.preview-text {
  margin: 0;
  font-family: var(--vscode-editor-font-family), monospace;
  font-size: 12px;
  line-height: 1.5;
  color: var(--vscode-foreground);
  white-space: pre-wrap;
  word-break: break-word;
}

.expanded {
  padding-top: 2px;
}

.footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 2px;
  border-top: 1px dashed var(--vscode-panel-border);
  margin-top: 2px;
}

.footer-spacer { flex: 1; }
.footer-right {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  white-space: nowrap;
}

/* Expand transition */
.task-expand-enter-active,
.task-expand-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}
.task-expand-enter-from,
.task-expand-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}

@media (prefers-reduced-motion: reduce) {
  .task-expand-enter-active,
  .task-expand-leave-active {
    transition: none;
  }
  .codicon-modifier-spin {
    animation: none !important;
  }
}
</style>

