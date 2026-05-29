import type { Attachment, ContextCommandPayload, ContextStatusSnapshot } from '../types'
import { sendToExtension } from '../utils/vscode'

export async function previewAttachment(att: Attachment) {
  if (!att.data) return
  await sendToExtension('previewAttachment', {
    name: att.name,
    mimeType: att.mimeType,
    data: att.data
  })
}

export interface WorkspaceInputFileAttachmentPayload {
  name: string
  size: number
  mimeType: string
  data: string
}

export interface ReadWorkspaceFileForInputResult {
  success: boolean
  path: string
  isText: boolean
  content?: string
  attachment?: WorkspaceInputFileAttachmentPayload
  error?: string
}

export async function readWorkspaceFileForInput(path: string) {
  return await sendToExtension<ReadWorkspaceFileForInputResult>('readWorkspaceFileForInput', {
    path
  })
}

export async function readWorkspaceTextFile(path: string) {
  return await sendToExtension<{ success: boolean; path: string; content: string; error?: string }>(
    'readWorkspaceTextFile',
    { path }
  )
}

export async function showContextContent(payload: { title: string; content: string; language: string }) {
  return await sendToExtension('showContextContent', payload)
}

export async function compactContext(conversationId: string, configId: string): Promise<ContextCommandPayload> {
  // 修改原因：主界面压缩按钮需要和 slash /compact 共用后端策略与 ledger/projection 语义，不能继续直接请求 summarizeContext。
  // 修改方式：封装普通 `context.compact` request/response handler，后端按 provider contextManagementMode 执行 trim 或 summarize。
  // 修改目的：压缩成功后返回 tokenAfter/projectionId，前端可以立即刷新状态与环状指示灯。
  return await sendToExtension<ContextCommandPayload>('context.compact', { conversationId, configId })
}

export async function getContextStatus(conversationId: string): Promise<ContextStatusSnapshot> {
  // 修改原因：上下文状态窗口需要通过普通 request/response 读取后端快照，不能走 chatStream 或创建聊天消息。
  // 修改方式：封装 `context.getStatus` webview handler，返回纯 ContextStatusSnapshot。
  // 修改目的：让按钮和 `/context-status` 键盘入口都只打开诊断 UI，不影响模型上下文。
  const result = await sendToExtension<{ status: ContextStatusSnapshot }>('context.getStatus', { conversationId })
  return result.status
}
