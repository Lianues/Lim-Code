import type { Attachment } from '../types'
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
