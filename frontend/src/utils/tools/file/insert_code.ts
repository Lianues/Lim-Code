/**
 * insert_code 工具注册
 */

import { registerTool } from '../../toolRegistry'
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
    if (!files || files.length === 0) return '无文件'
    return files.map(f => `${f.path} (第 ${f.line ?? '?'} 行前)`).join('\n')
  },
  
  // 使用自定义组件显示内容
  contentComponent: InsertCodeComponent,
  
  // 启用 diff 预览功能
  hasDiffPreview: true,
  
  // 获取所有插入的文件路径
  getDiffFilePath: (args) => {
    const files = args.files as InsertEntry[] | undefined
    if (!files || files.length === 0) return []
    return files.map(f => f.path)
  }
})
