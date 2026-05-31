/**
 * apply_diff 工具注册
 */

import { registerTool } from '../../toolRegistry'
import { createDiffPreviewAction } from '../diffPreviewAction'
import ApplyDiffComponent from '../../../components/tools/file/apply_diff.vue'

// 结构化 hunk 类型。为什么要新增：后端 apply_diff 新推荐格式使用 oldContent/newContent，前端摘要需要直接统计 hunks 数量。
interface StructuredHunk {
  oldContent: string
  newContent: string
  startLine?: number
}

// 注册 apply_diff 工具
registerTool('apply_diff', {
  name: 'apply_diff',
  label: '应用差异',
  icon: 'codicon-diff',
  
  // 描述生成器 - 显示文件路径和 diff 数量
  descriptionFormatter: (args) => {
    const path = args.path as string | undefined
    const hunks = args.hunks as StructuredHunk[] | undefined
    const patch = args.patch as string | undefined

    if (!path) return '无文件'

    if (Array.isArray(hunks) && hunks.length > 0) {
      return `${path}\n${hunks.length} 个更改`
    }

    if (patch && typeof patch === 'string' && patch.trim()) {
      const hunkCount = (patch.replace(/\r\n/g, '\n').replace(/\r/g, '\n').match(/^@@/gm) || []).length
      return `${path}\n${hunkCount} 个更改`
    }

    return `${path}\n0 个更改`
  },
  
  // 使用自定义组件显示内容
  contentComponent: ApplyDiffComponent,
  actions: [
    // 修改原因：diff 预览按钮已迁移到 ToolConfig actions，不能再依赖 ToolMessage.vue 的 hasDiffPreview 特判。
    // 修改方式：通过共享 createDiffPreviewAction 声明打开 diff 预览所需的文件路径解析逻辑。
    // 修改目的：主窗口和 SubAgent Monitor 复用同一工具 action 渲染机制。
    createDiffPreviewAction((args) => (args.path as string) || '')
  ]
})
