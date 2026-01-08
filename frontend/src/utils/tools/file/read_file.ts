/**
 * read_file 工具注册
 */

import { registerTool } from '../../toolRegistry'
import ReadFileComponent from '../../../components/tools/file/read_file.vue'

interface FileRequest {
  path: string
  startLine?: number
  endLine?: number
}

// 注册 read_file 工具
registerTool('read_file', {
  name: 'read_file',
  label: '读取文件',
  icon: 'codicon-file-text',
  
  // 描述生成器 - 显示文件路径和行范围
  descriptionFormatter: (args) => {
    if (!args.files || !Array.isArray(args.files)) {
      return '?'
    }
    
    return (args.files as FileRequest[]).map(f => {
      let desc = f.path || '?'
      if (f.startLine !== undefined && f.endLine !== undefined) {
        desc += ` [L${f.startLine}-${f.endLine}]`
      } else if (f.startLine !== undefined) {
        desc += ` [L${f.startLine}+]`
      } else if (f.endLine !== undefined) {
        desc += ` [L1-${f.endLine}]`
      }
      return desc
    }).join('\n')
  },
  
  // 使用自定义组件显示内容
  contentComponent: ReadFileComponent
})
