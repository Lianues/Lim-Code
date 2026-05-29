<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { IconButton, Tooltip, CustomScrollbar } from '../common'
import { useI18n } from '../../i18n'
import { useChatStore } from '../../stores'
import type { SkillDiagnosticItem, SkillItem, SkillsLoadReport } from '../../services/skills'
import {
  checkSkillsExistence,
  getSkillsDirectory,
  getSkillsLoadReport,
  listSkills,
  openDirectory,
  refreshSkills,
  removeSkillConfig,
  setSkillEnabled
} from '../../services/skills'

const { t } = useI18n()
const chatStore = useChatStore()

const skills = ref<SkillItem[]>([])
const showSkillsPanel = ref(false)
const showDiagnostics = ref(false)
const expandedSkillIds = ref<Set<string>>(new Set())
const loadReport = ref<SkillsLoadReport>({ loaded: [], skipped: [] })

const loadingCount = ref(0)
const isLoadingSkills = computed(() => loadingCount.value > 0)

async function withLoading<T>(fn: () => Promise<T>): Promise<T> {
  loadingCount.value++
  try {
    return await fn()
  } finally {
    loadingCount.value--
  }
}

async function loadSkillsReport() {
  try {
    // 为什么要加：仅加载成功列表无法解释 Skill 为什么没有出现。
    // 怎么改：同步读取后端 SkillsManager 的结构化 load report。
    // 目的：让 skipped reason、source 和 loaded warning/info 在面板中可见。
    loadReport.value = await getSkillsLoadReport()
  } catch (error) {
    console.error('Failed to load skills report:', error)
    loadReport.value = { loaded: [], skipped: [] }
  }
}

async function loadSkills() {
  try {
    // Skill 配置是全局的，不传 conversationId，始终读取全局配置。
    skills.value = await listSkills()
    await loadSkillsReport()
  } catch (error) {
    console.error('Failed to load skills:', error)
    skills.value = []
    loadReport.value = { loaded: [], skipped: [] }
  }
}

const refreshButtonIcon = computed(() =>
  isLoadingSkills.value
    ? 'codicon-refresh codicon-modifier-spin'
    : 'codicon-refresh'
)

async function refreshSkillsExistence() {
  if (skills.value.length === 0) return

  try {
    const result = await checkSkillsExistence(skills.value.map(s => s.id))
    if (result?.skills) {
      for (const skillResult of result.skills) {
        const skill = skills.value.find(s => s.id === skillResult.id)
        if (skill) skill.exists = skillResult.exists
      }
    }
  } catch (error) {
    console.error('Failed to check skills existence:', error)
  }
}

async function handleToggleSkillEnabled(id: string, enabled: boolean) {
  try {
    // Skill 启用/禁用是全局操作，不传 conversationId。
    // 原先传了 conversationId 导致走对话级分支，SkillsManager 全局状态和
    // read_skill 工具声明都不会更新，AI 看到的 Skill 列表锁定在旧值。
    await setSkillEnabled(id, enabled)
    const skill = skills.value.find(s => s.id === id)
    if (skill) skill.enabled = enabled
  } catch (error: any) {
    console.error('Failed to toggle skill enabled:', error)
  }
}

async function handleRemoveSkillConfig(id: string) {
  try {
    // Skill 配置是全局的，不传 conversationId。
    await removeSkillConfig(id)
    skills.value = skills.value.filter(s => s.id !== id)
  } catch (error: any) {
    console.error('Failed to remove skill config:', error)
  }
}

async function handleOpenSkillsDirectory() {
  try {
    const result = await getSkillsDirectory()
    if (result?.path) {
      await openDirectory(result.path)
    }
  } catch (error: any) {
    console.error('Failed to open skills directory:', error)
  }
}

async function handleRefreshSkills() {
  if (isLoadingSkills.value) return

  await withLoading(async () => {
    try {
      await refreshSkills()
      await loadSkills()
      await refreshSkillsExistence()
    } catch (error: any) {
      console.error('Failed to refresh skills:', error)
    }
  })
}

async function toggleSkillsPanel() {
  showSkillsPanel.value = !showSkillsPanel.value
  if (showSkillsPanel.value) {
    await withLoading(async () => {
      await loadSkills()
      await refreshSkillsExistence()
    })
  }
}

const enabledSkillsCount = computed(() => skills.value.filter(s => s.enabled && s.exists !== false).length)
const skippedDiagnostics = computed(() => loadReport.value.skipped || [])
const loadedDiagnostics = computed(() => loadReport.value.loaded.flatMap(item => item.diagnostics || []))
const allDiagnostics = computed(() => {
  // 为什么要改：一次 refresh 过程中同一个低优先级 Skill 可能通过不同入口被重复汇总，UI 重复展示会影响排障和复制。
  // 怎么改：按 severity/code/skillId/source/filePath/message 去重，只去掉完全相同的诊断，不合并不同来源。
  // 目的：保持诊断事实完整，同时让用户能一键复制干净的诊断清单。
  const seen = new Set<string>()
  const result: SkillDiagnosticItem[] = []
  for (const diagnostic of [...skippedDiagnostics.value, ...loadedDiagnostics.value]) {
    const key = [
      diagnostic.severity,
      diagnostic.code,
      diagnostic.skillId || '',
      diagnostic.source || '',
      diagnostic.filePath || '',
      diagnostic.message
    ].join('\u0000')
    if (seen.has(key)) continue
    seen.add(key)
    result.push(diagnostic)
  }
  return result
})
const diagnosticCount = computed(() => allDiagnostics.value.length)

function formatSkillSource(source?: string): string {
  // 为什么要改：新增 builtin 来源后，UI 不应直接暴露低层枚举值，也不能针对具体内置 Skill ID 写显示特判。
  // 怎么改：只按通用来源类别映射成人类可读标签，未知来源仍回退原值以兼容未来扩展。
  // 目的：让 builtin、project、user 等来源可读，同时保持新增来源无需修改核心逻辑。
  const labels: Record<string, string> = {
    'project-limcode': 'Project (.limcode)',
    'project-agents': 'Project (.agents)',
    'user-limcode': 'User (.limcode)',
    'user-agents': 'User (.agents)',
    builtin: 'Built-in'
  }
  return source ? (labels[source] || source) : ''
}

function formatDiagnosticForCopy(diagnostic: SkillDiagnosticItem): string {
  const lines = [
    diagnostic.skillId || diagnostic.field || diagnostic.code,
    diagnostic.severity,
    diagnostic.message
  ]
  const meta = [formatSkillSource(diagnostic.source), diagnostic.filePath].filter(Boolean).join(' · ')
  if (meta) lines.push(meta)
  return lines.join('\n')
}

async function copyAllDiagnostics() {
  // 为什么要加：诊断列表可能很多，用户无法一次性手动选择和复制完整内容。
  // 怎么改：把当前已去重的诊断格式化成纯文本写入剪贴板。
  // 目的：便于用户粘贴给 AI 或 issue，而不是截屏或逐条复制。
  const text = allDiagnostics.value.map(formatDiagnosticForCopy).join('\n\n')
  if (!text) return
  await navigator.clipboard.writeText(text)
}

function toggleDiagnosticsPanel() {
  showDiagnostics.value = !showDiagnostics.value
}

function toggleSkillPreview(id: string) {
  // 为什么要加：description 只放在 title tooltip 中时，多行/超长内容不可读，也无法确认 block scalar 是否正确折叠。
  // 怎么改：用 Set 记录展开状态，点击 Skill 名称即可切换内联 preview。
  // 目的：让用户直接在 Skills 面板中验证 description 实际加载结果。
  const next = new Set(expandedSkillIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedSkillIds.value = next
}

function diagnosticIcon(diagnostic: SkillDiagnosticItem): string {
  if (diagnostic.severity === 'fatal') return 'codicon-error'
  if (diagnostic.severity === 'warning') return 'codicon-warning'
  return 'codicon-info'
}

onMounted(() => {
  void withLoading(loadSkills)
})

watch(() => chatStore.currentConversationId, async () => {
  await withLoading(loadSkills)
  if (showSkillsPanel.value) {
    await refreshSkillsExistence()
  }
})
</script>

<template>
  <Tooltip :content="t('components.input.skills')" placement="top">
    <div class="skills-button-wrapper">
      <IconButton
        icon="codicon-lightbulb"
        size="small"
        :class="{ 'has-skills': enabledSkillsCount > 0 }"
        class="skills-button"
        @click="toggleSkillsPanel"
      />
      <span v-if="enabledSkillsCount > 0" class="skills-badge">
        {{ enabledSkillsCount }}
      </span>
    </div>
  </Tooltip>

  <div v-if="showSkillsPanel" class="skills-panel">
    <div class="skills-header">
      <span class="skills-title">
        <i class="codicon codicon-lightbulb"></i>
        {{ t('components.input.skillsPanel.title') }}
      </span>
      <div class="skills-header-actions">
        <IconButton
          v-if="diagnosticCount > 0"
          icon="codicon-warning"
          size="small"
          @click="toggleDiagnosticsPanel"
          :tooltip="t('components.input.skillsPanel.diagnostics')"
        />
        <IconButton
          :icon="refreshButtonIcon"
          size="small"
          :disabled="isLoadingSkills"
          @click="handleRefreshSkills"
          :tooltip="t('components.input.skillsPanel.refresh')"
        />
        <IconButton
          icon="codicon-folder-opened"
          size="small"
          @click="handleOpenSkillsDirectory"
          :tooltip="t('components.input.skillsPanel.openDirectory')"
        />
        <IconButton
          icon="codicon-close"
          size="small"
          @click="showSkillsPanel = false"
        />
      </div>
    </div>
    <div class="skills-description">
      {{ t('components.input.skillsPanel.description') }}
    </div>
    <div v-if="diagnosticCount > 0" class="skills-diagnostics-summary" @click="toggleDiagnosticsPanel">
      <i class="codicon codicon-warning"></i>
      <span>{{ t('components.input.skillsPanel.diagnosticsCount').replace('{count}', String(diagnosticCount)) }}</span>
    </div>
    <div v-if="showDiagnostics && diagnosticCount > 0" class="skills-diagnostics-list">
      <div class="skills-diagnostics-toolbar">
        <span>{{ t('components.input.skillsPanel.diagnostics') }}</span>
        <IconButton
          icon="codicon-copy"
          size="small"
          @click="copyAllDiagnostics"
          :tooltip="t('components.input.skillsPanel.copyDiagnostics')"
        />
      </div>
      <div class="skills-diagnostics-scroll">
      <div
        v-for="(diagnostic, index) in allDiagnostics"
        :key="`${diagnostic.skillId || diagnostic.filePath || diagnostic.code}-${index}`"
        class="skills-diagnostic-item"
        :class="diagnostic.severity"
      >
        <i :class="['codicon', diagnosticIcon(diagnostic)]"></i>
        <div class="skills-diagnostic-text">
          <div class="skills-diagnostic-title">
            {{ diagnostic.skillId || diagnostic.field || diagnostic.code }}
            <span class="skills-diagnostic-severity">{{ diagnostic.severity }}</span>
          </div>
          <div class="skills-diagnostic-message">{{ diagnostic.message }}</div>
          <div v-if="diagnostic.filePath || diagnostic.source" class="skills-diagnostic-meta">
            {{ formatSkillSource(diagnostic.source) }}<span v-if="diagnostic.source && diagnostic.filePath"> · </span>{{ diagnostic.filePath || '' }}
          </div>
        </div>
      </div>
      </div>
    </div>
    <CustomScrollbar class="skills-content" :maxHeight="200">
      <div v-if="isLoadingSkills" class="skills-loading">
        <i class="codicon codicon-loading codicon-modifier-spin"></i>
        <span>{{ t('components.input.skillsPanel.loading') }}</span>
      </div>
      <div v-else-if="skills.length === 0" class="skills-empty">
        <i class="codicon codicon-info"></i>
        <span>{{ t('components.input.skillsPanel.empty') }}</span>
      </div>
      <div v-else class="skills-list">
        <div
          v-for="skill in skills"
          :key="skill.id"
          class="skill-item"
          :class="{ disabled: !skill.enabled, 'not-exists': skill.exists === false }"
        >
          <div class="skill-row">
            <label class="skill-checkbox-wrapper" :title="t('components.input.skillsPanel.enableTooltip')">
              <input
                type="checkbox"
                :checked="skill.enabled"
                @change="handleToggleSkillEnabled(skill.id, !skill.enabled)"
                :disabled="skill.exists === false"
              />
              <span class="skill-checkbox-custom"></span>
            </label>
            <div class="skill-info">
              <i :class="['codicon', skill.exists === false ? 'codicon-warning' : 'codicon-lightbulb']"></i>
              <span class="skill-name" :title="skill.description" @click="toggleSkillPreview(skill.id)">{{ skill.name }}</span>
              <span v-if="skill.exists === false" class="skill-not-exists-hint">{{ t('components.input.skillsPanel.notExists') }}</span>
            </div>
            <div class="skill-actions">
              <IconButton
                v-if="skill.exists === false"
                icon="codicon-close"
                size="small"
                @click="handleRemoveSkillConfig(skill.id)"
                :title="t('components.input.remove')"
              />
            </div>
          </div>
          <div v-if="skill.source" class="skill-source">
            {{ t('components.input.skillsPanel.source') }}: {{ formatSkillSource(skill.source) }}
          </div>
          <div v-if="expandedSkillIds.has(skill.id)" class="skill-description-preview">
            {{ skill.description || t('components.input.skillsPanel.noDescription') }}
          </div>
        </div>
      </div>
    </CustomScrollbar>
    <div class="skills-footer">
      <div class="skills-hint">
        <i class="codicon codicon-info"></i>
        <span>{{ t('components.input.skillsPanel.hint') }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.skills-button-wrapper {
  position: relative;
  display: inline-flex;
}

.skills-button :deep(i.codicon) {
  font-size: 16px;
}

.skills-button.has-skills :deep(i.codicon) {
  color: var(--vscode-charts-yellow);
}

.skills-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  font-size: 10px;
  font-weight: 500;
  line-height: 14px;
  text-align: center;
  color: var(--vscode-badge-foreground);
  background: var(--vscode-badge-background);
  border-radius: 7px;
}

.skills-panel {
  position: absolute;
  bottom: 100%;
  left: 8px;
  right: 8px;
  margin-bottom: 8px;
  background: var(--vscode-editorWidget-background);
  border: 1px solid var(--vscode-editorWidget-border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 100;
  max-height: 420px;
  display: flex;
  flex-direction: column;
}

.skills-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-bottom: 1px solid var(--vscode-panel-border);
}

.skills-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.skills-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
}

.skills-title .codicon {
  color: var(--vscode-charts-yellow);
}

.skills-description {
  padding: 6px 10px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  border-bottom: 1px solid var(--vscode-panel-border);
}

.skills-diagnostics-summary {
  /* 为什么要加：加载失败过去只在 console 中出现，普通用户看不到。
     怎么改：在面板内提供一个可点击的诊断摘要条。
     目的：让用户能从同一个入口展开 skipped reason 和兼容性提示。 */
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  font-size: 11px;
  color: var(--vscode-editorWarning-foreground);
  background: rgba(255, 200, 0, 0.08);
  border-bottom: 1px solid var(--vscode-panel-border);
  cursor: pointer;
}

.skills-diagnostics-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editor-background);
}

.skills-diagnostics-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: var(--vscode-foreground);
}

.skills-diagnostics-scroll {
  /* 为什么要改：诊断数量多时面板会撑满屏幕，用户也无法滚动到末尾。
     怎么改：只让诊断详情区域内部滚动，保持顶部操作按钮可见。
     目的：保证大量诊断仍可浏览、复制和定位。 */
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 160px;
  overflow-y: auto;
  padding-right: 4px;
}

.skills-diagnostic-item {
  display: flex;
  gap: 6px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.skills-diagnostic-item.fatal .codicon {
  color: var(--vscode-errorForeground);
}

.skills-diagnostic-item.warning .codicon {
  color: var(--vscode-editorWarning-foreground);
}

.skills-diagnostic-title {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--vscode-foreground);
}

.skills-diagnostic-severity {
  font-size: 10px;
  opacity: 0.8;
}

.skills-diagnostic-message,
.skills-diagnostic-meta {
  word-break: break-word;
}

.skills-diagnostic-meta {
  opacity: 0.75;
}

.skills-content {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
}

.skills-loading,
.skills-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}

.skills-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
}

.skill-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  background: var(--vscode-editor-background);
  border-radius: 4px;
  transition: background-color 0.15s;
}

.skill-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.skill-item:hover {
  background: var(--vscode-list-hoverBackground);
}

.skill-item.disabled {
  opacity: 0.6;
}

.skill-item.not-exists {
  border: 1px dashed var(--vscode-editorWarning-foreground);
}

.skill-item.not-exists .codicon-warning {
  color: var(--vscode-editorWarning-foreground);
}

.skill-checkbox-wrapper {
  position: relative;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  flex-shrink: 0;
}

.skill-checkbox-wrapper input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.skill-checkbox-custom {
  width: 14px;
  height: 14px;
  border: 1px solid var(--vscode-checkbox-border, rgba(255, 255, 255, 0.3));
  border-radius: 3px;
  background: var(--vscode-checkbox-background, rgba(255, 255, 255, 0.1));
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.skill-checkbox-wrapper input:checked + .skill-checkbox-custom {
  background: var(--vscode-badge-background, rgba(255, 255, 255, 0.2));
  border-color: var(--vscode-badge-background, rgba(255, 255, 255, 0.4));
}

.skill-checkbox-wrapper input:checked + .skill-checkbox-custom::after {
  content: '';
  width: 4px;
  height: 8px;
  border: solid var(--vscode-checkbox-foreground, #fff);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
  margin-bottom: 2px;
}

.skill-checkbox-wrapper input:disabled + .skill-checkbox-custom {
  opacity: 0.5;
  cursor: not-allowed;
}

.skill-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.skill-info .codicon-lightbulb {
  color: var(--vscode-charts-yellow);
  flex-shrink: 0;
}

.skill-name {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.skill-source,
.skill-description-preview {
  margin-left: 28px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  word-break: break-word;
}

.skill-description-preview {
  padding: 4px 6px;
  white-space: pre-wrap;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 3px;
}

.skill-not-exists-hint {
  font-size: 10px;
  color: var(--vscode-editorWarning-foreground);
  padding: 1px 4px;
  background: rgba(255, 200, 0, 0.1);
  border-radius: 3px;
  flex-shrink: 0;
}

.skill-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.skills-footer {
  padding: 6px 10px;
  border-top: 1px solid var(--vscode-panel-border);
}

.skills-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.skills-hint .codicon {
  font-size: 12px;
}

:deep(.codicon-refresh.codicon-modifier-spin) {
  /* codicon.css 只对部分 icon 默认开启 spin，这里补齐 refresh */
  animation: codicon-spin 1.5s steps(30) infinite;
}

@media (prefers-reduced-motion: reduce) {
  :deep(.codicon-refresh.codicon-modifier-spin) {
    animation: none;
  }
}
</style>
