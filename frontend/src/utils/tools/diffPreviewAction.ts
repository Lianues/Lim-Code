import type { ToolActionConfig } from '../toolRegistry'
import type { ToolUsage } from '../../types'
import { t } from '../../i18n'
import { sendToExtension } from '../vscode'

export type DiffFilePathResolver = (
  args: Record<string, unknown>,
  result?: Record<string, unknown>
) => string | string[]

function resolveDiffFilePaths(tool: ToolUsage, resolver: DiffFilePathResolver): string[] {
  const result = tool.result as Record<string, unknown> | undefined
  const raw = resolver(tool.args || {}, result)
  if (Array.isArray(raw)) return raw.filter(path => typeof path === 'string' && path.trim())
  return typeof raw === 'string' && raw.trim() ? [raw.trim()] : []
}

export function createDiffPreviewAction(resolver: DiffFilePathResolver): ToolActionConfig {
  return {
    id: 'open-diff-preview',
    label: () => t('components.message.tool.viewDiff'),
    title: () => t('components.message.tool.viewDiffInVSCode'),
    icon: 'codicon-diff',
    variant: 'default',
    visible(tool) {
      // 修改原因：write_file/apply_diff 等工具过去由 ToolMessage.vue 的 hasDiffPreview 特判显示按钮，导致新 ToolConfig actions 无法统一承载显眼操作。
      // 修改方式：diff action 自己根据 resolver 是否能解析到文件路径决定可见性。
      // 修改目的：所有 diff 工具和 SubAgent 详情入口都走同一个 actions 渲染通道，主窗口与 SubAgent Monitor 同步受益。
      return resolveDiffFilePaths(tool, resolver).length > 0
    },
    async run(tool) {
      const paths = resolveDiffFilePaths(tool, resolver)
      if (paths.length === 0) return

      // 修改原因：diff.openPreview 需要可结构化克隆的数据，直接传 Vue 响应式对象可能失败。
      // 修改方式：沿用旧 ToolMessage 逻辑，对 args/result 做 JSON 序列化拷贝。
      // 修改目的：迁移到 ToolConfig action 后保持旧 diff 预览行为不变。
      const serializedArgs = JSON.parse(JSON.stringify(tool.args || {}))
      const serializedResult = tool.result ? JSON.parse(JSON.stringify(tool.result)) : undefined

      await sendToExtension('diff.openPreview', {
        toolId: tool.id,
        toolName: tool.name,
        filePaths: paths,
        args: serializedArgs,
        result: serializedResult
      })
    }
  }
}
