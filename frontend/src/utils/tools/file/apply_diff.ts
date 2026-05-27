/**
 * apply_diff 工具注册
 */

import { registerTool } from '../../toolRegistry'
import ApplyDiffComponent from '../../../components/tools/file/apply_diff.vue'

// 单个 diff 块类型
interface DiffBlock {
  search: string
  replace: string
  start_line?: number
}

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
    const diffs = args.diffs as DiffBlock[] | undefined
    const patch = args.patch as string | undefined

    if (!path) return '无文件'

    // 为什么优先统计 hunks：这是新的推荐输入格式，不能再只看 patch/diffs，否则工具卡片会显示 0 个更改。
    // 怎么改：存在结构化 hunks 时直接使用数组长度；旧 patch/diffs 仍保留兼容。
    // 目的：让历史记录、工具气泡和后端新协议的展示保持一致。
    if (Array.isArray(hunks) && hunks.length > 0) {
      return `${path}\n${hunks.length} 个更改`
    }

    // 兼容格式：unified diff patch（按 hunk 数量统计）
    if (patch && typeof patch === 'string' && patch.trim()) {
      const hunkCount = (patch.replace(/\r\n/g, '\n').replace(/\r/g, '\n').match(/^@@/gm) || []).length
      return `${path}\n${hunkCount} 个更改`
    }

    // 旧格式：search/replace diffs 数组长度
    const diffCount = diffs?.length || 0
    return `${path}\n${diffCount} 个更改`
  },
  
  // 使用自定义组件显示内容
  contentComponent: ApplyDiffComponent,
  
  // 启用 diff 预览功能
  hasDiffPreview: true,
  
  // 获取 diff 文件路径
  getDiffFilePath: (args) => {
    return (args.path as string) || ''
  }
})