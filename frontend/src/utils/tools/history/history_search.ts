/**
 * history_search 工具注册
 *
 * 搜索和读取被上下文总结压缩的历史对话内容
 */

import { registerTool } from '../../toolRegistry'
import { t } from '../../../i18n'
import HistorySearchPanel from '../../../components/tools/history/history_search.vue'

registerTool('history_search', {
  name: 'history_search',
  label: t('components.tools.history.historySearch'),
  icon: 'codicon-history',

  labelFormatter: (args) => {
    const mode = args.mode as string || 'search'
    return mode === 'read'
      ? t('components.tools.history.readHistory')
      : t('components.tools.history.searchHistory')
  },

  descriptionFormatter: (args) => {
    const mode = args.mode as string || 'search'

    if (mode === 'search') {
      const query = args.query as string || ''
      const isRegex = args.is_regex as boolean || false
      return isRegex ? `/${query}/` : `"${query}"`
    }

    if (mode === 'read') {
      const startLine = args.start_line as number | undefined
      const endLine = args.end_line as number | undefined
      if (startLine !== undefined && endLine !== undefined) {
        return `L${startLine}-${endLine}`
      }
      if (startLine !== undefined) {
        return `L${startLine}+`
      }
      return t('components.tools.history.readAll')
    }

    return mode
  },

  contentComponent: HistorySearchPanel
})
