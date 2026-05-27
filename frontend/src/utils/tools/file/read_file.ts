/**
 * read_file 工具注册
 */

import { registerTool } from '../../toolRegistry'
import ReadFileComponent from '../../../components/tools/file/read_file.vue'

interface FileRequest {
  path: string
  startLine?: number
  endLine?: number
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
}

function isNonTextReadTarget(path: string | undefined): boolean {
  if (!path) return false
  const ext = path.split('?')[0].split('#')[0].toLowerCase().match(/\.([^.\/\\]+)$/)?.[1]
  return !!ext && [
    'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'ico', 'tiff',
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'mp3', 'wav', 'aac', 'ogg', 'flac', 'mp4', 'mov', 'avi', 'webm',
    'zip', 'rar', '7z', 'exe', 'dll'
  ].includes(ext)
}

// 注册 read_file 工具
registerTool('read_file', {
  name: 'read_file',
  label: '读取文件',
  icon: 'codicon-file-text',
  
  // 描述生成器 - 显示文件路径和行范围
  descriptionFormatter: (args) => {
    const file = args as unknown as FileRequest
    let desc = file.path || '?'
    if (isNonTextReadTarget(file.path)) {
      return desc
    }
    const startLine = isPositiveInteger(file.startLine) ? file.startLine : undefined
    const endLine = isPositiveInteger(file.endLine) ? file.endLine : undefined
    if (startLine !== undefined && endLine !== undefined) {
      desc += ` [L${startLine}-${endLine}]`
    } else if (startLine !== undefined) {
      desc += ` [L${startLine}+]`
    } else if (endLine !== undefined) {
      desc += ` [L1-${endLine}]`
    }
    return desc
  },
  
  // 使用自定义组件显示内容
  contentComponent: ReadFileComponent
})
