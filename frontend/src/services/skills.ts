/**
 * Skills 服务层
 * 
 * 重构后 Skill 采用 read_skill 工具按需加载模式，
 * 不再使用 toggle_skills 拼接注入。
 */
import { sendToExtension } from '../utils/vscode'

export interface SkillItem {
  id: string
  name: string
  description: string
  enabled: boolean
  /** @deprecated 不再使用拼接注入模式，保留字段仅为向后兼容 */
  sendContent: boolean
  exists?: boolean
  /** Skill 来源层级 */
  source?: string
}

export async function listSkills(conversationId?: string | null): Promise<SkillItem[]> {
  const config = await sendToExtension<{ skills: SkillItem[] }>('getSkillsConfig', { conversationId })
  return config?.skills || []
}

export async function checkSkillsExistence(ids: string[]) {
  return await sendToExtension<{ skills: Array<{ id: string; exists: boolean }> }>('checkSkillsExistence', {
    skills: ids.map(id => ({ id }))
  })
}

export async function setSkillEnabled(id: string, enabled: boolean, conversationId?: string | null) {
  return await sendToExtension('setSkillEnabled', { id, enabled, conversationId })
}

export async function removeSkillConfig(id: string, conversationId?: string | null) {
  return await sendToExtension('removeSkillConfig', { id, conversationId })
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
