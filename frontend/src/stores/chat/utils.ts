/**
 * Chat Store 通用工具函数
 */

import { translate } from '../../composables/useI18n'
import { useSettingsStore } from '../settingsStore'

/**
 * 格式化时间
 */
export function formatTime(timestamp: number): string {
  const settingsStore = useSettingsStore()
  const lang = settingsStore.language || 'zh-CN'
  
  const now = Date.now()
  const diff = now - timestamp
  
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  
  if (diff < minute) {
    return translate(lang, 'stores.chatStore.relativeTime.justNow')
  } else if (diff < hour) {
    const minutes = Math.floor(diff / minute)
    return translate(lang, 'stores.chatStore.relativeTime.minutesAgo', { minutes })
  } else if (diff < day) {
    const hours = Math.floor(diff / hour)
    return translate(lang, 'stores.chatStore.relativeTime.hoursAgo', { hours })
  } else if (diff < 7 * day) {
    const days = Math.floor(diff / day)
    return translate(lang, 'stores.chatStore.relativeTime.daysAgo', { days })
  } else {
    return new Date(timestamp).toLocaleDateString()
  }
}
