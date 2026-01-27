<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { IconButton, Tooltip, CustomScrollbar } from '../common'
import { useI18n } from '../../i18n'
import type { SkillItem } from '../../services/skills'
import {
  checkSkillsExistence,
  getSkillsDirectory,
  listSkills,
  openDirectory,
  refreshSkills,
  removeSkillConfig,
  setSkillEnabled,
  setSkillSendContent
} from '../../services/skills'

const { t } = useI18n()

const skills = ref<SkillItem[]>([])
const showSkillsPanel = ref(false)

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

async function loadSkills() {
  try {
    skills.value = await listSkills()
  } catch (error) {
    console.error('Failed to load skills:', error)
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
    await setSkillEnabled(id, enabled)
    const skill = skills.value.find(s => s.id === id)
    if (skill) skill.enabled = enabled
  } catch (error: any) {
    console.error('Failed to toggle skill enabled:', error)
  }
}

async function handleToggleSkillSendContent(id: string, sendContent: boolean) {
  try {
    await setSkillSendContent(id, sendContent)
    const skill = skills.value.find(s => s.id === id)
    if (skill) skill.sendContent = sendContent
  } catch (error: any) {
    console.error('Failed to toggle skill send content:', error)
  }
}

async function handleRemoveSkillConfig(id: string) {
  try {
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

onMounted(() => {
  void withLoading(loadSkills)
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
            <span class="skill-name" :title="skill.description">{{ skill.name }}</span>
            <span v-if="skill.exists === false" class="skill-not-exists-hint">{{ t('components.input.skillsPanel.notExists') }}</span>
          </div>
          <div class="skill-actions">
            <label
              class="skill-toggle-switch"
              :class="{ disabled: !skill.enabled || skill.exists === false }"
              :title="t('components.input.skillsPanel.sendContentTooltip')"
            >
              <input
                type="checkbox"
                :checked="skill.sendContent"
                @change="handleToggleSkillSendContent(skill.id, !skill.sendContent)"
                :disabled="!skill.enabled || skill.exists === false"
              />
              <span class="skill-toggle-slider"></span>
            </label>
            <IconButton
              v-if="skill.exists === false"
              icon="codicon-close"
              size="small"
              @click="handleRemoveSkillConfig(skill.id)"
              :title="t('components.input.remove')"
            />
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
  max-height: 300px;
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
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: var(--vscode-editor-background);
  border-radius: 4px;
  transition: background-color 0.15s;
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

.skill-toggle-switch {
  position: relative;
  display: inline-block;
  width: 28px;
  height: 16px;
  cursor: pointer;
  flex-shrink: 0;
}

.skill-toggle-switch.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.skill-toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.skill-toggle-slider {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border);
  border-radius: 8px;
  transition: 0.2s;
}

.skill-toggle-slider::before {
  position: absolute;
  content: "";
  height: 10px;
  width: 10px;
  left: 2px;
  bottom: 2px;
  background-color: var(--vscode-foreground);
  border-radius: 50%;
  transition: 0.2s;
}

.skill-toggle-switch input:checked + .skill-toggle-slider {
  background-color: var(--vscode-charts-yellow);
  border-color: var(--vscode-charts-yellow);
}

.skill-toggle-switch input:checked + .skill-toggle-slider::before {
  transform: translateX(12px);
  background-color: var(--vscode-editor-background);
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
