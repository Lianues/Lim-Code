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

export async function readWorkspaceTextFile(path: string) {
  return await sendToExtension<{ success: boolean; path: string; content: string; error?: string }>(
    'readWorkspaceTextFile',
    { path }
  )
}

export async function showContextContent(payload: { title: string; content: string; language: string }) {
  return await sendToExtension('showContextContent', payload)
}
