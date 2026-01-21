<script setup lang="ts">
import ChannelSelector, { type ChannelOption } from './ChannelSelector.vue'
import ModelSelector, { type ModelInfo } from './ModelSelector.vue'
import ModeSelector, { type PromptMode } from './ModeSelector.vue'
import { useI18n } from '../../i18n'

const { t } = useI18n()

const props = defineProps<{
  currentModeId: string
  modeOptions: PromptMode[]
  isLoadingConfigs: boolean

  configId: string
  channelOptions: ChannelOption[]

  currentModelId: string
  modelOptions: ModelInfo[]
  modelDisabled: boolean
}>()

const emit = defineEmits<{
  (e: 'mode-change', modeId: string): void
  (e: 'open-mode-settings'): void
  (e: 'channel-change', channelId: string): void
  (e: 'model-change', modelId: string): void
}>()
</script>

<template>
  <div class="selector-bar">
    <div class="mode-selector-wrapper">
      <ModeSelector
        :model-value="props.currentModeId"
        :options="props.modeOptions"
        :disabled="props.isLoadingConfigs"
        :drop-up="true"
        @update:model-value="emit('mode-change', $event)"
        @open-settings="emit('open-mode-settings')"
      />
    </div>

    <span class="selector-separator"></span>

    <div class="channel-selector-wrapper">
      <ChannelSelector
        :model-value="props.configId"
        :options="props.channelOptions"
        :placeholder="t('components.input.selectChannel')"
        :disabled="props.isLoadingConfigs"
        :drop-up="true"
        @update:model-value="emit('channel-change', $event)"
      />
    </div>

    <span class="selector-separator"></span>

    <div class="model-selector-wrapper">
      <ModelSelector
        :models="props.modelOptions"
        :model-value="props.currentModelId"
        :disabled="props.modelDisabled"
        @update:model-value="emit('model-change', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.selector-bar {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
  padding-top: 4px;
  border-top: 1px solid var(--vscode-panel-border);
  max-width: 420px;
}

.mode-selector-wrapper {
  flex-shrink: 0;
}

.channel-selector-wrapper {
  flex: 1;
  min-width: 0;
  max-width: 140px;
}

.channel-selector-wrapper :deep(.channel-selector) {
  width: 100%;
}

.channel-selector-wrapper :deep(.selector-dropdown) {
  width: 180px;
  min-width: 180px;
}

.model-selector-wrapper {
  flex: 1;
  min-width: 0;
  max-width: 140px;
}

.model-selector-wrapper :deep(.model-selector) {
  width: 100%;
}

.selector-separator {
  width: 1px;
  height: 14px;
  background: var(--vscode-panel-border);
  opacity: 0.6;
  flex-shrink: 0;
}
</style>
