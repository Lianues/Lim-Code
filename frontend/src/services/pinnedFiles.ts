import { sendToExtension } from '../utils/vscode'

export interface PinnedFileItem {
  id: string
  path: string
  workspaceUri: string
  enabled: boolean
  addedAt: number
  exists?: boolean
}

export interface ValidatePinnedFileResult {
  valid: boolean
  relativePath?: string
  workspaceUri?: string
  error?: string
  errorCode?: string
}

export interface AddPinnedFileResult {
  success: boolean
  file?: PinnedFileItem
  error?: string
  errorCode?: string
}

export async function listPinnedFiles(): Promise<PinnedFileItem[]> {
  const config = await sendToExtension<{ files: PinnedFileItem[] }>('getPinnedFilesConfig', {})
  return config?.files || []
}

export async function checkPinnedFilesExistence(files: Array<{ id: string; path: string }>) {
  return await sendToExtension<{ files: Array<{ id: string; exists: boolean }> }>(
    'checkPinnedFilesExistence',
    { files }
  )
}

export async function validatePinnedFile(pathOrUri: string): Promise<ValidatePinnedFileResult> {
  return await sendToExtension<ValidatePinnedFileResult>('validatePinnedFile', { path: pathOrUri })
}

export async function addPinnedFile(path: string | undefined, workspaceUri: string | undefined): Promise<AddPinnedFileResult> {
  return await sendToExtension<AddPinnedFileResult>('addPinnedFile', { path, workspaceUri })
}

export async function removePinnedFile(id: string) {
  return await sendToExtension('removePinnedFile', { id })
}

export async function setPinnedFileEnabled(id: string, enabled: boolean) {
  return await sendToExtension('setPinnedFileEnabled', { id, enabled })
}
