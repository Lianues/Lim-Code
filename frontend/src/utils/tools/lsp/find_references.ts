/**
 * find_references 工具注册
 */

import { registerTool } from '../../toolRegistry'
import FindReferencesComponent from '../../../components/tools/lsp/find_references.vue'

// 注册 find_references 工具
registerTool('find_references', {
  name: 'find_references',
  label: '查找引用',
  icon: 'codicon-references',
  
  // 描述生成器
  descriptionFormatter: (args) => {
    const path = args.path as string || ''
    const line = args.line as number || 0
    const symbol = args.symbol as string || ''
    
    if (symbol) {
      return `${symbol} (${path}:${line})`
    }
    return `${path}:${line}`
  },
  
  // 使用自定义组件显示内容
  contentComponent: FindReferencesComponent
})
