/**
 * 格式化工具函数
 */

// 格式化相对时间（如"刚刚"、"3分钟前"）
export function formatRelativeTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  
  // 小于1分钟
  if (diff < 60000) {
    return '刚刚'
  }
  
  // 小于1小时
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000)
    return `${minutes}分钟前`
  }
  
  // 小于1天
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000)
    return `${hours}小时前`
  }
  
  // 小于7天
  if (diff < 604800000) {
    const days = Math.floor(diff / 86400000)
    return `${days}天前`
  }
  
  // 显示完整日期
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// 格式化时间戳（支持自定义格式）
export function formatTime(timestamp: number, format = 'YYYY-MM-DD HH:mm:ss'): string {
  const date = new Date(timestamp)
  
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  
  return format
    .replace('YYYY', String(year))
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds)
}

// 格式化完整时间
export function formatFullTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

// 截断文本
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength) + '...'
}

// 高亮搜索关键词
export function highlightText(text: string, keyword: string): string {
  if (!keyword) return text
  
  const regex = new RegExp(`(${escapeRegExp(keyword)})`, 'gi')
  return text.replace(regex, '<mark>$1</mark>')
}

/**
 * 转义正则表达式特殊字符。
 *
 * WP13b 修改原因：前端高亮路径在 format.ts、history_search.vue、search_in_files.vue、
 * FilePickerPanel.vue 各自复制同语义正则转义实现。
 * 修改方式：format.ts 暴露唯一前端 helper，组件统一 import 使用。
 * 修改目的：只移动实现归属，不改变任何高亮、搜索结果或 UI 输出结构。
 */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 计算文本哈希
export function hashText(text: string): string {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(36)
}

// 生成随机颜色
export function generateColor(seed: string): string {
  const hash = hashText(seed)
  const hue = parseInt(hash, 36) % 360
  return `hsl(${hue}, 70%, 60%)`
}

// 复制到剪贴板
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch (error) {
    console.error('复制失败:', error)
    return false
  }
}

// 防抖函数
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: number | undefined
  
  return function (...args: Parameters<T>) {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
    
    timeoutId = setTimeout(() => {
      fn(...args)
    }, delay) as unknown as number
  }
}

// 节流函数
export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let lastCall = 0
  
  return function (...args: Parameters<T>) {
    const now = Date.now()
    
    if (now - lastCall >= delay) {
      lastCall = now
      fn(...args)
    }
  }
}

// 延迟执行
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// 生成唯一ID
export function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

// 判断是否为空值
export function isEmpty(value: any): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.keys(value).length === 0
  return false
}

// 深度克隆
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj
  
  if (obj instanceof Date) return new Date(obj.getTime()) as any
  if (obj instanceof Array) return obj.map(item => deepClone(item)) as any
  
  const clonedObj = {} as T
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      clonedObj[key] = deepClone(obj[key])
    }
  }
  
  return clonedObj
}

// 格式化数字（添加千分位分隔符，始终保留一位小数）
export function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M'
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K'
  }
  return num.toLocaleString()
}