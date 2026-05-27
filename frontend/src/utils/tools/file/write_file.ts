/**
 * write_file 工具注册
 */

import { registerTool } from '../../toolRegistry'
import { createDiffPreviewAction } from '../diffPreviewAction'
import WriteFileComponent from '../../../components/tools/file/write_file.vue'

// 注册 write_file 工具
registerTool('write_file', {
  name: 'write_file',
  label: '写入文件',
  icon: 'codicon-save',
  
  // 描述生成器 - 显示文件路径（每行一个）
  descriptionFormatter: (args) => {
    const path = args.path as string | undefined
    return path || '无文件'
  },
  
  // 使用自定义组件显示内容
  contentComponent: WriteFileComponent,
  actions: [
    // 修改原因：write_file 的 diff 预览按钮需要和其它显眼操作统一走 ToolConfig actions。
    // 修改方式：复用 createDiffPreviewAction，把文件路径解析逻辑留在工具注册处。
    // 修改目的：删除 ToolMessage.vue 中的 diff 专用分支，同时保持原按钮行为。
    createDiffPreviewAction((args) => {
      const path = args.path as string | undefined
      if (!path) return []
      return [path]
    })
  ]
})
