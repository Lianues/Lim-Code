/**
 * search_in_files 工具注册
 */

import { registerTool } from '../../toolRegistry'
import { createDiffPreviewAction } from '../diffPreviewAction'
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
  actions: [
    createDiffPreviewAction((args: Record<string, unknown>, result?: Record<string, unknown>) => {
      // 修改原因：search_in_files 只有 replace 模式会生成 diff，旧 hasDiffPreview 需要迁移为 action 的 visible 条件。
      // 修改方式：resolver 在非 replace 模式返回空数组；共享 action 会因此隐藏按钮。
      // 修改目的：搜索模式不显示 diff 按钮，替换模式继续保留旧的查看差异行为。
      const mode = args.mode as string || 'search'
      if (mode !== 'replace') {
        return []
      }
      
      const resultData = result?.data as Record<string, unknown> | undefined
      const results = resultData?.results as Array<{ file: string }> | undefined
      
      if (!results || results.length === 0) {
        return []
      }
      
      return results.map(r => r.file)
    })
  ]
})