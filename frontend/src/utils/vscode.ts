/**
 * VSCode API 通信工具
 */

import type { VSCodeMessage, VSCodeRequest } from '../types'
import { playCue } from '../services/soundCues'

// 获取 VSCode API
declare function acquireVsCodeApi(): any

let vscodeApi: any = null

export function getVSCodeAPI() {
  if (!vscodeApi) {
    vscodeApi = acquireVsCodeApi()
  }
  return vscodeApi
}

// 消息请求ID生成器
let requestIdCounter = 0
export function generateRequestId(): string {
  return `req_${Date.now()}_${++requestIdCounter}`
}

// 发送消息到插件
// 注意：不设置前端超时，后端渠道配置已有超时设置
export function sendToExtension<T = any>(type: string, data: any): Promise<T> {
  return new Promise((resolve, reject) => {
    const requestId = generateRequestId()
    const vscode = getVSCodeAPI()
    
    // 注册响应处理器
    messageHandlers.set(requestId, {
      resolve: (data: T) => {
        resolve(data)
      },
      reject: (error: Error) => {
        reject(error)
      }
    })
    
    // 发送消息
    try {
      vscode.postMessage({
        type,
        requestId,
        data
      } as VSCodeRequest)
    } catch (err: any) {
      // 例如：payload 过大导致 structured clone / postMessage 失败
      messageHandlers.delete(requestId)
      const msg = typeof err?.message === 'string' && err.message.trim()
        ? err.message
        : 'Failed to post message to VS Code extension'
      reject(new Error(msg))
    }
  })
}

// 消息处理器映射
interface MessageHandler<T = any> {
  resolve: (data: T) => void
  reject: (error: Error) => void
}

const messageHandlers = new Map<string, MessageHandler>()

// 监听来自插件的消息
export function onMessageFromExtension(
  handler: (message: VSCodeMessage) => void
): () => void {
  const listener = (event: MessageEvent) => {
    const message = event.data
    
    // 忽略非对象消息
    if (!message || typeof message !== 'object') {
      return
    }
    
    // 处理请求响应
    if (message.requestId && messageHandlers.has(message.requestId)) {
      const responseHandler = messageHandlers.get(message.requestId)!
      messageHandlers.delete(message.requestId)
      
      if (message.success) {
        responseHandler.resolve(message.data)
      } else {
        responseHandler.reject(new Error(message.error?.message || 'Unknown error'))
      }
      return
    }
    
    // 处理其他消息（主动推送的消息）
    // 包括命令消息、流式响应等
    if (message.type) {
      handler(message as VSCodeMessage)
    }
  }
  
  window.addEventListener('message', listener)
  
  // 返回取消监听函数
  return () => {
    window.removeEventListener('message', listener)
  }
}

/**
 * 监听来自插件的命令推送
 * 
 * @param command 命令名称
 * @param handler 处理器
 * @returns 取消监听函数
 */
export function onExtensionCommand<T = any>(
  command: string,
  handler: (data: T) => void
): () => void {
  return onMessageFromExtension((message: any) => {
    if (message.type === 'command' && message.command === command) {
      handler(message.data)
    }
  })
}

// 状态持久化
export function saveState(key: string, value: any) {
  const vscode = getVSCodeAPI()
  const state = vscode.getState() || {}
  state[key] = value
  vscode.setState(state)
}

export function loadState<T = any>(key: string, defaultValue?: T): T | undefined {
  const vscode = getVSCodeAPI()
  const state = vscode.getState() || {}
  return state[key] !== undefined ? state[key] : defaultValue
}

export function clearState() {
  const vscode = getVSCodeAPI()
  vscode.setState({})
}

/**
 * 显示 VSCode 通知
 *
 * @param message 通知消息
 * @param type 通知类型：'info' | 'warning' | 'error'
 */
export async function showNotification(
  message: string,
  type: 'info' | 'warning' | 'error' = 'info'
): Promise<void> {
  try {
    // 声音提醒（失败不影响通知本身）
    if (type === 'warning') {
      void playCue('warning')
    } else if (type === 'error') {
      void playCue('error')
    }

    await sendToExtension('showNotification', { message, type })
  } catch (err) {
    console.error('Failed to show notification:', err)
  }
}

/**
 * 加载 diff 内容（用于 apply_diff 工具的按需加载）
 *
 * @param diffContentId Diff 内容 ID
 * @returns Diff 内容或 null
 */
export async function loadDiffContent(diffContentId: string): Promise<{
  originalContent: string
  newContent: string
  filePath: string
} | null> {
  try {
    const result = await sendToExtension<{
      success: boolean
      originalContent?: string
      newContent?: string
      filePath?: string
      error?: string
    }>('diff.loadContent', { diffContentId })
    
    if (result.success && result.originalContent && result.newContent) {
      return {
        originalContent: result.originalContent,
        newContent: result.newContent,
        filePath: result.filePath || ''
      }
    }
    return null
  } catch (err) {
    console.error('Failed to load diff content:', err)
    return null
  }
}