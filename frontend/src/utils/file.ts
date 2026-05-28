/**
 * 文件处理工具
 */

import type { Attachment, AttachmentType } from '../types'
// WP14: generateId 已统合到 format.ts，此处从 format 导入，消除重复定义
import { generateId } from './format'
import {
  MAX_ATTACHMENT_SIZE,
  SUPPORTED_DOCUMENT_TYPES
} from '../types'

/**
 * 根据文件扩展名推断 MIME 类型
 *
 * 当浏览器无法识别某些文件扩展名（如 .md）时返回空字符串，
 * 需要根据文件名来推断正确的 MIME 类型
 *
 * @param filename 文件名
 * @param browserMimeType 浏览器提供的 MIME 类型（可能为空）
 * @returns 推断的 MIME 类型
 */
export function inferMimeType(filename: string, browserMimeType: string): string {
  // 如果已有有效的 MIME 类型，直接使用
  if (browserMimeType && browserMimeType.trim() !== '') {
    return browserMimeType
  }

  // 根据扩展名推断 MIME 类型
  const ext = filename.toLowerCase().split('.').pop() || ''

  const extensionToMimeType: Record<string, string> = {
    // 文本/代码文件
    'md': 'text/markdown',
    'markdown': 'text/markdown',
    'txt': 'text/plain',
    'json': 'application/json',
    'xml': 'application/xml',
    'html': 'text/html',
    'htm': 'text/html',
    'css': 'text/css',
    'js': 'text/javascript',
    'ts': 'text/typescript',
    'tsx': 'text/typescript',
    'jsx': 'text/javascript',
    'py': 'text/x-python',
    'java': 'text/x-java',
    'c': 'text/x-c',
    'cpp': 'text/x-c++',
    'h': 'text/x-c',
    'hpp': 'text/x-c++',
    'cs': 'text/x-csharp',
    'go': 'text/x-go',
    'rs': 'text/x-rust',
    'rb': 'text/x-ruby',
    'php': 'text/x-php',
    'swift': 'text/x-swift',
    'kt': 'text/x-kotlin',
    'scala': 'text/x-scala',
    'sh': 'text/x-shellscript',
    'bash': 'text/x-shellscript',
    'zsh': 'text/x-shellscript',
    'yaml': 'text/yaml',
    'yml': 'text/yaml',
    'toml': 'text/toml',
    'ini': 'text/plain',
    'cfg': 'text/plain',
    'conf': 'text/plain',
    'log': 'text/plain',
    'csv': 'text/csv',
    'sql': 'text/x-sql',
    'r': 'text/x-r',
    'lua': 'text/x-lua',
    'perl': 'text/x-perl',
    'pl': 'text/x-perl',
    'vue': 'text/x-vue',
    'svelte': 'text/x-svelte',

    // 图片文件
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'bmp': 'image/bmp',
    'ico': 'image/x-icon',

    // 音频文件
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'ogg': 'audio/ogg',
    'flac': 'audio/flac',
    'm4a': 'audio/mp4',
    'aac': 'audio/aac',

    // 视频文件
    'mp4': 'video/mp4',
    'webm': 'video/webm',
    'avi': 'video/x-msvideo',
    'mov': 'video/quicktime',
    'mkv': 'video/x-matroska',

    // 文档文件
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',

    // 压缩文件
    'zip': 'application/zip',
    'rar': 'application/x-rar-compressed',
    'tar': 'application/x-tar',
    'gz': 'application/gzip',
    '7z': 'application/x-7z-compressed'
  }

  return extensionToMimeType[ext] || 'application/octet-stream'
}

// 获取文件类型
export function getFileType(mimeType: string): AttachmentType {
  // 使用通用匹配，支持所有同类型文件
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (mimeType.startsWith('text/')) return 'code'
  if (SUPPORTED_DOCUMENT_TYPES.includes(mimeType)) return 'document'
  return 'document'
}

// 验证文件
export function validateFile(file: File): { valid: boolean; error?: string } {
  // 检查文件大小
  if (file.size > MAX_ATTACHMENT_SIZE) {
    return {
      valid: false,
      error: `文件大小超过限制 (${formatFileSize(MAX_ATTACHMENT_SIZE)})`
    }
  }
  
  // 允许任意文件类型
  return { valid: true }
}

// 读取文件为 Base64
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    
    reader.onload = () => {
      const result = reader.result as string
      // 移除 data URL 前缀，只保留 base64 数据
      const base64 = result.split(',')[1]
      resolve(base64)
    }
    
    reader.onerror = () => {
      reject(new Error('读取文件失败'))
    }
    
    reader.readAsDataURL(file)
  })
}

// 读取文件为文本
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    
    reader.onload = () => {
      resolve(reader.result as string)
    }
    
    reader.onerror = () => {
      reject(new Error('读取文件失败'))
    }
    
    reader.readAsText(file)
  })
}

// 创建文件附件对象
export async function createAttachment(file: File): Promise<Attachment> {
  const id = generateId()
  const type = getFileType(file.type)
  const data = await readFileAsBase64(file)
  
  const attachment: Attachment = {
    id,
    name: file.name,
    type,
    size: file.size,
    mimeType: file.type,
    data
  }
  
  // 为图片生成缩略图
  if (type === 'image') {
    attachment.thumbnail = await createThumbnail(file)
  }
  
  return attachment
}

// 生成缩略图
export function createThumbnail(file: File, maxSize = 200): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    
    img.onload = () => {
      // 计算缩略图尺寸
      let width = img.width
      let height = img.height
      
      if (width > height) {
        if (width > maxSize) {
          height = height * (maxSize / width)
          width = maxSize
        }
      } else {
        if (height > maxSize) {
          width = width * (maxSize / height)
          height = maxSize
        }
      }
      
      canvas.width = width
      canvas.height = height
      
      ctx.drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL(file.type))
    }
    
    img.onerror = () => {
      reject(new Error('生成缩略图失败'))
    }
    
    const reader = new FileReader()
    reader.onload = (e) => {
      img.src = e.target?.result as string
    }
    reader.readAsDataURL(file)
  })
}

// 格式化文件大小
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// WP14: generateId 已从 format.ts 导入，此处不再重复定义
// 下载文件
export function downloadFile(data: string, filename: string, mimeType: string) {
  const blob = base64ToBlob(data, mimeType)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

// Base64 转 Blob
function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteCharacters = atob(base64)
  const byteArrays = []
  
  for (let i = 0; i < byteCharacters.length; i++) {
    byteArrays.push(byteCharacters.charCodeAt(i))
  }
  
  return new Blob([new Uint8Array(byteArrays)], { type: mimeType })
}