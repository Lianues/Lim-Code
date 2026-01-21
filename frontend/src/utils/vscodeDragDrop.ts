export type VscodeDropItemSource =
  | 'vscodeUriList'
  | 'resourceurls'
  | 'codeeditors'
  | 'textUriList'
  | 'plainText'
  | 'files'

export interface VscodeDropItem {
  uriOrPath: string
  source: VscodeDropItemSource
}

function isValidFileUri(uri: string): boolean {
  if (!uri || typeof uri !== 'string') return false
  // Support local file:// and remote vscode-remote://
  return uri.startsWith('file://') || uri.startsWith('vscode-remote://')
}

/**
 * Extract file URI/path candidates from VSCode/webview drag&drop.
 * This is intentionally "lossy": it returns strings that the caller can
 * later resolve into workspace-relative paths (via extension APIs).
 */
export function extractVscodeDropItems(dt: DataTransfer): VscodeDropItem[] {
  const items: VscodeDropItem[] = []

  // 1) VSCode专用: application/vnd.code.uri-list
  const vscodeUriList = dt.getData('application/vnd.code.uri-list')
  if (vscodeUriList) {
    const uris = vscodeUriList
      .split('\n')
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('#') && isValidFileUri(s))

    for (const uri of uris) items.push({ uriOrPath: uri, source: 'vscodeUriList' })
    return items
  }

  // 2) VSCode专用: resourceurls (JSON array)
  const resourceUrls = dt.getData('resourceurls')
  if (resourceUrls) {
    try {
      const parsed = JSON.parse(resourceUrls)
      if (Array.isArray(parsed)) {
        for (const v of parsed) {
          if (typeof v === 'string' && v.trim()) {
            items.push({ uriOrPath: v.trim(), source: 'resourceurls' })
          }
        }
        if (items.length > 0) return items
      }
    } catch {
      // ignore
    }
  }

  // 3) VSCode专用: codeeditors (full editor info)
  const codeEditors = dt.getData('codeeditors')
  if (codeEditors) {
    try {
      const parsed = JSON.parse(codeEditors)
      if (Array.isArray(parsed)) {
        for (const editor of parsed) {
          const external = editor?.resource?.external
          if (typeof external === 'string' && external.trim() && isValidFileUri(external.trim())) {
            items.push({ uriOrPath: external.trim(), source: 'codeeditors' })
          }
        }
        if (items.length > 0) return items
      }
    } catch {
      // ignore
    }
  }

  // 4) 标准: text/uri-list
  const uriList = dt.getData('text/uri-list')
  if (uriList) {
    const uris = uriList
      .split('\n')
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('#'))

    for (const uri of uris) items.push({ uriOrPath: uri, source: 'textUriList' })
    if (items.length > 0) return items
  }

  // 5) 备选: text/plain
  const plainText = dt.getData('text/plain')
  if (plainText) {
    const lines = plainText
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)

    for (const line of lines) {
      if (isValidFileUri(line) || line.match(/^[a-zA-Z]:[\/\\]/) || line.startsWith('/')) {
        items.push({ uriOrPath: line, source: 'plainText' })
      }
    }
    if (items.length > 0) return items
  }

  // 6) Last resort: dt.files
  if (dt.files && dt.files.length > 0) {
    for (let i = 0; i < dt.files.length; i++) {
      const f = dt.files[i] as any
      const p = (f?.path as string | undefined) || dt.files[i].name
      if (p) items.push({ uriOrPath: p, source: 'files' })
    }
  }

  return items
}
