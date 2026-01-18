/**
 * search_in_files 工具注册
 */

import { registerTool } from '../../toolRegistry'
import SearchInFilesComponent from '../../../components/tools/search/search_in_files.vue'

// 注册 search_in_files 工具
registerTool('search_in_files', {
  name: 'search_in_files',
  label: '搜索内容',
  icon: 'codicon-search',
  
  // 动态标签 - 严格根据 mode 显示不同的标题
  labelFormatter: (args: Record<string, unknown>) => {
    const mode = args.mode as string || 'search'
    return mode === 'replace' ? '搜索替换' : '搜索内容'
  },
  
  // 描述生成器 - 显示搜索关键词和替换信息
  descriptionFormatter: (args: Record<string, unknown>) => {
    const query = args.query as string || ''
    const path = args.path as string || '.'
    const pattern = args.pattern as string || '**/*'
    const mode = args.mode as string || 'search'
    
    let desc = `"${query}"`
    
    // 替换模式显示替换内容
    if (mode === 'replace') {
      const replace = args.replace as string || ''
      desc += ` → "${replace}"`
    }
    
    // 显示路径和模式
    const extras: string[] = []
    if (path !== '.') {
      extras.push(path)
    }
    if (pattern !== '**/*') {
      extras.push(pattern)
    }
    if (extras.length > 0) {
      desc += ` in ${extras.join(', ')}`
    }
    
    return desc
  },
  
  // 使用自定义组件显示内容
  contentComponent: SearchInFilesComponent,
  
  // 启用 diff 预览功能（仅在替换模式下）
  hasDiffPreview: true,
  
  // 获取所有替换的文件路径
  getDiffFilePath: (args: Record<string, unknown>, result?: Record<string, unknown>) => {
    // 只有替换模式才支持 diff 预览
    const mode = args.mode as string || 'search'
    if (mode !== 'replace') {
      return []
    }
    
    // 从结果中获取替换的文件路径
    const resultData = result?.data as Record<string, unknown> | undefined
    const results = resultData?.results as Array<{ file: string }> | undefined
    
    if (!results || results.length === 0) {
      return []
    }
    
    return results.map(r => r.file)
  }
})