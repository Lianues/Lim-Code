/**
 * delete_code 工具注册
 */

import { registerTool } from '../../toolRegistry'
import { createDiffPreviewAction } from '../diffPreviewAction'
import DeleteCodeComponent from '../../../components/tools/file/delete_code.vue'

// 单个删除条目类型
interface DeleteEntry {
  path: string
  start_line: number
  end_line: number
}

// 注册 delete_code 工具
registerTool('delete_code', {
  name: 'delete_code',
  label: '删除代码',
  icon: 'codicon-diff-removed',
  
  // 描述生成器 - 显示文件路径列表（每行一个）
  descriptionFormatter: (args) => {
    const files = args.files as DeleteEntry[] | undefined
    if (!files || !Array.isArray(files) || files.length === 0) return '无文件'
    return files.map(f => `${f.path} (第 ${f.start_line ?? '?'}~${f.end_line ?? '?'} 行)`).join('\n')
  },
  
  // 使用自定义组件显示内容
  contentComponent: DeleteCodeComponent,
  actions: [
    // 修改原因：delete_code 的 diff 预览与其它显眼操作应共用 ToolConfig.actions。
    // 修改方式：复用 createDiffPreviewAction，并在工具注册处保留文件路径解析逻辑。
    // 修改目的：删除 ToolMessage 中的 hasDiffPreview 专用渲染逻辑。
    createDiffPreviewAction((args) => {
      const files = args.files as DeleteEntry[] | undefined
      if (!files || !Array.isArray(files) || files.length === 0) return []
      return files.map(f => f.path)
    })
  ]
})
