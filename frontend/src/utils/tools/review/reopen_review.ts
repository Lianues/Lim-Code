/**
 * reopen_review 工具注册（前端展示）
 */

import { registerTool } from '../../toolRegistry'
import { t } from '../../../i18n'
import { formatReviewToolFallbackContent } from '../../reviewCards'

registerTool('reopen_review', {
  name: 'reopen_review',
  label: t('components.message.tool.reopenReview.label'),
  icon: 'codicon-refresh',
  descriptionFormatter: (args) => {
    const path = (args as any)?.path as string | undefined
    if (path && path.trim()) return path.trim()
    return t('components.message.tool.reopenReview.fallbackTitle')
  },
  contentFormatter: (args, result) => formatReviewToolFallbackContent('reopen_review', args, result)
})
