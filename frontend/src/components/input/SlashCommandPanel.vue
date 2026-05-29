<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import CustomScrollbar from '../common/CustomScrollbar.vue'
import { listSkills, type SkillItem } from '../../services/skills'
import { useI18n } from '../../i18n'

const props = defineProps<{
  visible: boolean
  query: string
}>()

const emit = defineEmits<{
  selectSkill: [skill: SkillItem]
  completeCommand: [replacement: string]
  close: []
}>()

interface SlashCommandItem {
  id: string
  label: string
  description: string
  icon: string
  completionText: string
}

const skills = ref<SkillItem[]>([])
const selectedIndex = ref(0)
const loading = ref(false)
const scrollbarRef = ref<InstanceType<typeof CustomScrollbar>>()
let debounceTimer: ReturnType<typeof setTimeout> | null = null
const { t } = useI18n()

const mode = computed<'commands' | 'skills'>(() => {
  const q = props.query.trimStart().toLowerCase()
  return q === 'skill' || q.startsWith('skill ') ? 'skills' : 'commands'
})

const skillQuery = computed(() => {
  const q = props.query.trimStart()
  if (!q.toLowerCase().startsWith('skill')) return ''
  return q.slice('skill'.length).trim()
})

const commandItems = computed<SlashCommandItem[]>(() => [
  // 修改原因：slash 面板是 compact/summarize 的入口之一，描述文案不能绕过 i18n。
  // 修改方式：保留 label/completionText 作为协议命令文本，只把 description 接入 components.input.slashCommandPanel。
  // 修改目的：让命令补全面板在不同语言下说明一致，同时不影响后端 slash command 解析。
  {
    id: 'skill',
    label: '/skill',
    description: t('components.input.slashCommandPanel.descriptions.skill'),
    icon: 'codicon-lightbulb',
    completionText: '/skill '
  },
  {
    id: 'context-status',
    label: '/context-status',
    description: t('components.input.slashCommandPanel.descriptions.contextStatus'),
    icon: 'codicon-info',
    completionText: '/context-status'
  },
  {
    id: 'compact',
    label: '/compact',
    description: t('components.input.slashCommandPanel.descriptions.compact'),
    icon: 'codicon-archive',
    completionText: '/compact'
  },
  {
    id: 'summarize',
    label: '/summarize',
    description: t('components.input.slashCommandPanel.descriptions.summarize'),
    icon: 'codicon-fold',
    completionText: '/summarize'
  },
  {
    id: 'context-undo',
    label: '/context-undo',
    description: t('components.input.slashCommandPanel.descriptions.contextUndo'),
    icon: 'codicon-discard',
    completionText: '/context-undo'
  },
  {
    id: 'context-restore',
    label: '/context-restore',
    description: t('components.input.slashCommandPanel.descriptions.contextRestore'),
    icon: 'codicon-history',
    completionText: '/context-restore '
  },
  {
    id: 'context-reset',
    label: '/context-reset',
    description: t('components.input.slashCommandPanel.descriptions.contextReset'),
    icon: 'codicon-debug-restart',
    completionText: '/context-reset'
  }
].filter(item => {
  // 修改原因：P1 新增多条 context slash command，过滤逻辑不能继续只特判 skill。
  // 修改方式：统一按 label/id/description 做小写包含匹配。
  // 目的：后续新增命令时只扩 commandItems，不再改搜索分支。
  const q = props.query.trim().toLowerCase()
  return !q || item.label.toLowerCase().includes(q) || item.id.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)
}))

const skillItems = computed(() => {
  const q = skillQuery.value.toLowerCase()
  return skills.value
    .filter(skill => skill.exists !== false)
    .filter(skill => !q || skill.name.toLowerCase().includes(q) || (skill.description || '').toLowerCase().includes(q))
})

const itemsCount = computed(() => mode.value === 'commands' ? commandItems.value.length : skillItems.value.length)

async function loadSkills() {
  loading.value = true
  try {
    skills.value = await listSkills()
  } catch (error) {
    console.error('Failed to load skills for slash command:', error)
    skills.value = []
  } finally {
    loading.value = false
  }
}

function debouncedLoadSkills() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => void loadSkills(), 120)
}

function scrollToSelected() {
  nextTick(() => {
    const container = scrollbarRef.value?.getContainer()
    const selected = container?.querySelector('.slash-item.selected') as HTMLElement | null
    selected?.scrollIntoView({ block: 'nearest', behavior: 'auto' })
  })
}

function selectCurrent() {
  if (mode.value === 'commands') {
    const command = commandItems.value[selectedIndex.value]
    if (!command) return
    // 为什么这里不直接关闭面板：`/skill` 命令补全后还要继续选择具体 Skill；其他命令则补全为可直接发送的 slash command。
    // 怎么做：把完整替换文本交给父层，由 InputBox 在原斜杠触发范围内替换；完整 context command 的 Enter 执行由 InputBox 在更早的 keydown 阶段处理。
    // 目的：让 Tab 继续补全，完整 `/context-status` 的 Enter 直接执行，避免用户以为命令被普通发送给 AI。
    emit('completeCommand', command.completionText)
    return
  }
  const skill = skillItems.value[selectedIndex.value]
  if (!skill || !skill.enabled || skill.exists === false) return
  emit('selectSkill', skill)
}

function handleKeydown(e: KeyboardEvent | { key: string, preventDefault?: Function, stopPropagation?: Function }) {
  if (!props.visible) return
  if (e.key === 'ArrowDown') {
    e.preventDefault?.(); e.stopPropagation?.()
    selectedIndex.value = Math.min(selectedIndex.value + 1, Math.max(0, itemsCount.value - 1))
    scrollToSelected()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault?.(); e.stopPropagation?.()
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
    scrollToSelected()
  } else if (e.key === 'Enter') {
    e.preventDefault?.(); e.stopPropagation?.()
    selectCurrent()
  } else if (e.key === 'Escape') {
    e.preventDefault?.(); e.stopPropagation?.()
    emit('close')
  }
}

watch(() => props.visible, visible => {
  if (visible) {
    selectedIndex.value = 0
    debouncedLoadSkills()
  } else {
    selectedIndex.value = 0
  }
})

watch(() => props.query, () => {
  selectedIndex.value = 0
  if (mode.value === 'skills') debouncedLoadSkills()
})

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
})

defineExpose({ handleKeydown, selectCurrent })
</script>

<template>
  <div v-if="visible" class="slash-panel">
    <div class="slash-header">
      <i class="codicon codicon-terminal"></i>
      <span>{{ mode === 'skills' ? 'Select Skill' : 'Slash Commands' }}</span>
    </div>
    <CustomScrollbar ref="scrollbarRef" class="slash-content" :maxHeight="220">
      <div v-if="loading && mode === 'skills'" class="slash-empty">
        <i class="codicon codicon-loading codicon-modifier-spin"></i>
        <span>Loading skills...</span>
      </div>
      <template v-else-if="mode === 'commands'">
        <div
          v-for="(item, index) in commandItems"
          :key="item.id"
          class="slash-item"
          :class="{ selected: selectedIndex === index }"
          @mousedown.prevent="emit('completeCommand', item.completionText)"
        >
          <i :class="['codicon', item.icon]"></i>
          <div class="slash-info">
            <span class="slash-title">{{ item.label }}</span>
            <span class="slash-description">{{ item.description }}</span>
          </div>
        </div>
        <div v-if="commandItems.length === 0" class="slash-empty">No command</div>
      </template>
      <template v-else>
        <div
          v-for="(skill, index) in skillItems"
          :key="skill.id"
          class="slash-item"
          :class="{ selected: selectedIndex === index, disabled: !skill.enabled || skill.exists === false }"
          @mousedown.prevent="skill.enabled && skill.exists !== false && emit('selectSkill', skill)"
        >
          <i :class="['codicon', skill.exists === false ? 'codicon-warning' : 'codicon-lightbulb']"></i>
          <div class="slash-info">
            <span class="slash-title">{{ skill.name }}</span>
            <span class="slash-description">{{ skill.enabled ? skill.description : t('components.input.slashCommandPanel.skillDisabled') }}</span>
          </div>
        </div>
        <div v-if="skillItems.length === 0" class="slash-empty">{{ t('components.input.slashCommandPanel.noEnabledSkill') }}</div>
      </template>
    </CustomScrollbar>
    <div class="slash-footer">{{ t('components.input.slashCommandPanel.footer') }}</div>
  </div>
</template>

<style scoped>
.slash-panel {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 100%;
  margin-bottom: 8px;
  background: var(--vscode-editorWidget-background);
  border: 1px solid var(--vscode-editorWidget-border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
  z-index: 120;
  overflow: hidden;
}
.slash-header, .slash-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  border-bottom: 1px solid var(--vscode-panel-border);
}
.slash-footer {
  border-top: 1px solid var(--vscode-panel-border);
  border-bottom: none;
  font-size: 11px;
}
.slash-content { padding: 6px; }
.slash-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 4px;
  cursor: pointer;
}
.slash-item.selected, .slash-item:hover { background: var(--vscode-list-hoverBackground); }
.slash-item.disabled { opacity: 0.55; cursor: not-allowed; }
.slash-info { display: flex; flex-direction: column; min-width: 0; }
.slash-title { font-size: 12px; color: var(--vscode-foreground); }
.slash-description { font-size: 11px; color: var(--vscode-descriptionForeground); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.slash-empty { padding: 16px; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 12px; color: var(--vscode-descriptionForeground); }
kbd { font-family: var(--vscode-editor-font-family), monospace; }
</style>
