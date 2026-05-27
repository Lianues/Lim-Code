/**
 * insert_code 工具注册
 */

import { registerTool } from '../../toolRegistry'
import { createDiffPreviewAction } from '../diffPreviewAction'
import InsertCodeComponent from '../../../components/tools/file/insert_code.vue'

// 单个插入条目类型
interface InsertEntry {
  path: string
  line: number
  content: string
}

// 注册 insert_code 工具
registerTool('insert_code', {
  name: 'insert_code',
  label: '插入代码',
  icon: 'codicon-diff-added',
  
  // 描述生成器 - 显示文件路径列表（每行一个）
  descriptionFormatter: (args) => {
    const files = args.files as InsertEntry[] | undefined
    if (!files || !Array.isArray(files) || files.length === 0) return '无文件'
    return files.map(f => `${f.path} (第 ${f.line ?? '?'} 行前)`).join('\n')
  },
  
  // 使用自定义组件显示内容
  contentComponent: InsertCodeComponent,
  actions: [
    // 修改原因：insert_code 的 diff 预览按钮不应继续由 ToolMessage 专用逻辑渲染。
    // 修改方式：将文件列表解析封装为共享 diff preview action。
    // 修改目的：所有显眼操作按钮统一由 ToolConfig.actions 驱动。
    createDiffPreviewAction((args) => {
      const files = args.files as InsertEntry[] | undefined
      if (!files || !Array.isArray(files) || files.length === 0) return []
      return files.map(f => f.path)
    })
  ]
})
