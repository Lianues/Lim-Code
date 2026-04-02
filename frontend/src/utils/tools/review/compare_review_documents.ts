/**
 * compare_review_documents 工具注册（前端展示）
 */

import { registerTool } from '../../toolRegistry'
import { t } from '../../../i18n'

function formatCompareResult(args: Record<string, unknown>, result?: Record<string, unknown>): string {
  const data = ((result as any)?.data || {}) as Record<string, any>
  const summary = (data.summary || {}) as Record<string, any>
  const base = (data.base || {}) as Record<string, any>
  const target = (data.target || {}) as Record<string, any>

  const basePath = String(base.path || (args as any)?.basePath || '').trim()
  const targetPath = String(target.path || (args as any)?.targetPath || '').trim()

  const lines = [
    `${t('components.message.tool.compareReviewDocuments.base')}: ${basePath || '-'}`,
    `${t('components.message.tool.compareReviewDocuments.target')}: ${targetPath || '-'}`,
    `${t('components.message.tool.compareReviewDocuments.addedFindings')}: ${summary.addedFindings ?? 0}`,
    `${t('components.message.tool.compareReviewDocuments.removedFindings')}: ${summary.removedFindings ?? 0}`,
    `${t('components.message.tool.compareReviewDocuments.persistedFindings')}: ${summary.persistedFindings ?? 0}`,
    `${t('components.message.tool.compareReviewDocuments.severityChanged')}: ${summary.severityChanged ?? 0}`,
    `${t('components.message.tool.compareReviewDocuments.trackingChanged')}: ${summary.trackingChanged ?? 0}`
  ]

  return lines.join('\n')
}

registerTool('compare_review_documents', {
  name: 'compare_review_documents',
  label: t('components.message.tool.compareReviewDocuments.label'),
  icon: 'codicon-git-compare',
  descriptionFormatter: (args) => {
    const basePath = (args as any)?.basePath as string | undefined
    const targetPath = (args as any)?.targetPath as string | undefined
    if (basePath && targetPath) return `${basePath} → ${targetPath}`
    return t('components.message.tool.compareReviewDocuments.fallbackTitle')
  },
  contentFormatter: (args, result) => formatCompareResult(args, result)
})
