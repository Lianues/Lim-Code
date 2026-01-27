import { sendToExtension } from '../utils/vscode'

export interface SkillItem {
  id: string
  name: string
  description: string
  enabled: boolean
  sendContent: boolean
  exists?: boolean
}

export async function listSkills(): Promise<SkillItem[]> {
  const config = await sendToExtension<{ skills: SkillItem[] }>('getSkillsConfig', {})
  return config?.skills || []
}

export async function checkSkillsExistence(ids: string[]) {
  return await sendToExtension<{ skills: Array<{ id: string; exists: boolean }> }>('checkSkillsExistence', {
    skills: ids.map(id => ({ id }))
  })
}

export async function setSkillEnabled(id: string, enabled: boolean) {
  return await sendToExtension('setSkillEnabled', { id, enabled })
}

export async function setSkillSendContent(id: string, sendContent: boolean) {
  return await sendToExtension('setSkillSendContent', { id, sendContent })
}

export async function removeSkillConfig(id: string) {
  return await sendToExtension('removeSkillConfig', { id })
}

export async function refreshSkills() {
  return await sendToExtension('refreshSkills', {})
}

export async function getSkillsDirectory(): Promise<{ path: string | null }> {
  return await sendToExtension('getSkillsDirectory', {}) as { path: string | null }
}

export async function openDirectory(path: string) {
  return await sendToExtension('openDirectory', { path })
}
