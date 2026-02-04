import type { PromptMode } from '../components/input/ModeSelector.vue'
import type { ModelInfo } from '../types'
import { sendToExtension } from '../utils/vscode'

export async function listConfigIds(): Promise<string[]> {
  return await sendToExtension<string[]>('config.listConfigs', {})
}

export async function getConfig(configId: string): Promise<any> {
  return await sendToExtension('config.getConfig', { configId })
}

export async function updateConfig(configId: string, updates: Record<string, any>) {
  return await sendToExtension('config.updateConfig', { configId, updates })
}

export async function getPromptModes() {
  return await sendToExtension<{ modes: PromptMode[]; currentModeId: string }>('getPromptModes', {})
}

export async function setCurrentPromptMode(modeId: string) {
  return await sendToExtension('setCurrentPromptMode', { modeId })
}

export async function getChannelModels(configId: string): Promise<ModelInfo[]> {
  return await sendToExtension<ModelInfo[]>('models.getModels', { configId })
}
