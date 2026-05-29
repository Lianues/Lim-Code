/**
 * Skill 工具展示共享 helper。
 *
 * 为什么要加：read_skill_resource 和 execute_skill_script 都需要从 ToolResult 中解析
 * skillName、relativePath、sha256、状态等字段；如果分别在组件内实现，后续安全字段过滤
 * 和状态协议很容易出现两套逻辑。
 * 怎么改：把安全读取、短 hash、pending 状态判断和文本预览收敛到本文件。
 * 目的：让 Skill 工具卡片只渲染白名单字段，不完整 dump result，从前端层继续维护
 * “不暴露 Skill 绝对路径 / staging 路径”的安全边界。
 */
import type { ToolUsage } from '../../../types'

export type ToolStatus = ToolUsage['status']

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

export function getResultData(result?: Record<string, unknown>): Record<string, unknown> | undefined {
  const data = asRecord(result?.data)
  return data || result
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter(item => typeof item === 'string') as string[]
}

export function getSkillName(args: Record<string, unknown>, data?: Record<string, unknown>): string {
  return asString(data?.skillName) || asString(data?.name) || asString(args.name) || 'unknown'
}

export function getRelativePath(args: Record<string, unknown>, data?: Record<string, unknown>): string {
  return asString(data?.relativePath) || asString(args.relativePath) || 'unknown'
}

export function shortSha256(sha256: unknown): string {
  const value = asString(sha256)
  return value ? `${value.slice(0, 12)}…` : ''
}

export function isPendingStatus(status?: ToolStatus, result?: Record<string, unknown>, error?: string): boolean {
  if (error || result) return false
  return status === 'streaming' || status === 'queued' || status === 'executing' || status === 'awaiting_approval'
}

export function previewText(value: unknown, maxChars = 6000): { text: string; clipped: boolean } {
  const text = typeof value === 'string' ? value : ''
  if (text.length <= maxChars) {
    return { text, clipped: false }
  }
  return { text: `${text.slice(0, maxChars)}\n…`, clipped: true }
}

export function isUnsafeDisplayKey(key: string): boolean {
  const normalized = key.toLowerCase()
  return normalized.includes('realpath') ||
    normalized.includes('basepath') ||
    normalized.includes('staging') ||
    normalized.includes('stagedpath') ||
    normalized.includes('stageddir') ||
    normalized.includes('absolutepath') ||
    normalized.includes('canonicalpath')
}
