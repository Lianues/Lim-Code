/**
 * google_search 工具注册
 */

import { registerTool } from '../../toolRegistry'
import GoogleSearchComponent from '../../../components/tools/search/google_search.vue'
import { useI18n } from '../../../i18n'

const { t } = useI18n()

// 注册 google_search 工具
registerTool('google_search', {
  name: 'google_search',
  label: t('components.tools.search.googleSearch'),
  icon: 'codicon-search',
  
  // 描述生成器 - 显示查询词
  descriptionFormatter: (args) => {
    return args.queries ? (args.queries as string[]).join(', ') : (args.query as string || '')
  },
  
  // 使用自定义组件显示内容
  contentComponent: GoogleSearchComponent
})
