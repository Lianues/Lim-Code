import { sendToExtension } from './vscode'

export interface ResolvedWorkspaceItem {
  path: string
  isDirectory: boolean
}

/**
 * Resolve a set of uri/path strings into workspace-relative paths.
 * Kept outside InputBox to avoid coupling the editor to VSCode extension APIs.
 */
export async function resolveWorkspaceItems(inputs: string[]): Promise<ResolvedWorkspaceItem[]> {
  const results: ResolvedWorkspaceItem[] = []

  for (const raw of inputs) {
    const input = (raw || '').trim()
    if (!input) continue

    try {
      const r = await sendToExtension<{ relativePath: string; isDirectory?: boolean }>('getRelativePath', {
        absolutePath: input
      })
      if (r?.relativePath) {
        results.push({ path: r.relativePath, isDirectory: !!r.isDirectory })
        continue
      }
    } catch {
      // fallback below
    }

    // Fallback: best-effort file name
    try {
      if (input.startsWith('file://') || input.startsWith('vscode-remote://')) {
        const url = new URL(input)
        const pathName = decodeURIComponent(url.pathname)
        const fileName = pathName.split('/').pop()
        if (fileName) {
          results.push({ path: fileName, isDirectory: false })
          continue
        }
      }
    } catch {
      // ignore
    }

    const fileName = input.split(/[/\\]/).pop()
    if (fileName) {
      results.push({ path: fileName, isDirectory: false })
    }
  }

  return results
}
