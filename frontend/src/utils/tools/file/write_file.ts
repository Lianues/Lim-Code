/**
 * write_file 工具注册
 */

import { registerTool } from '../../toolRegistry'
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
  
  // 启用 diff 预览功能
  hasDiffPreview: true,
  
  // 获取所有写入的文件路径
  getDiffFilePath: (args) => {
    const path = args.path as string | undefined
    if (!path) return []
    return [path]
  }
})
