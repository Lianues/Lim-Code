import type { EditorNode } from '../../../types/editorNode'
import type { PromptContextItem } from '../../../types/promptContext'
import { createContextNode, createTextNode, normalizeNodes } from '../../../types/editorNode'
import { createContextChipElement, type ChipHandlers } from './ContextChipFactory'

export interface ContextIconInfo {
  class: string
  isFileIcon: boolean
}

export interface RenderOptions {
  getContextIcon: (ctx: PromptContextItem) => ContextIconInfo
  chipHandlers: ChipHandlers
}

export interface ExtractOptions {
  knownNodes: EditorNode[]
  transientContexts: Map<string, PromptContextItem>
}

export function extractNodesFromEditor(editor: HTMLElement, opts: ExtractOptions): EditorNode[] {
  const nodes: EditorNode[] = []

  function traverse(element: Node) {
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const raw = child.textContent || ''
        const text = raw.replace(/\u200B/g, '')
        if (text) nodes.push(createTextNode(text))
        continue
      }

      if (child.nodeType !== Node.ELEMENT_NODE) continue

      const el = child as HTMLElement

      if (el.classList.contains('context-chip')) {
        const contextId = el.dataset.contextId
        let context = opts.knownNodes
          .filter((n): n is { type: 'context'; context: PromptContextItem } => n.type === 'context')
          .find(n => n.context.id === contextId)?.context

        if (!context && contextId) context = opts.transientContexts.get(contextId)
        if (context) nodes.push(createContextNode(context))
        continue
      }

      if (el.tagName === 'BR') {
        if (el.dataset.limBreak === '1') {
          nodes.push(createTextNode('\n'))
        }
        continue
      }

      if (el.tagName === 'DIV' || el.tagName === 'P') {
        traverse(el)
        if (child.nextSibling) nodes.push(createTextNode('\n'))
        continue
      }

      traverse(el)
    }
  }

  traverse(editor)
  return normalizeNodes(nodes)
}

export function renderNodesToDOM(editor: HTMLElement, nodes: EditorNode[], opts: RenderOptions) {
  const selection = window.getSelection()
  let savedRange: Range | null = null
  if (selection && selection.rangeCount > 0) {
    savedRange = selection.getRangeAt(0).cloneRange()
  }

  editor.innerHTML = ''

  const appendZwsp = () => {
    const last = editor.lastChild
    if (last && last.nodeType === Node.TEXT_NODE && (last as Text).data === '\u200B') return
    editor.appendChild(document.createTextNode('\u200B'))
  }

  for (const node of nodes) {
    if (node.type === 'text') {
      const parts = node.text.split('\n')
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]) editor.appendChild(document.createTextNode(parts[i]))
        if (i < parts.length - 1) {
          const br = document.createElement('br')
          br.dataset.limBreak = '1'
          editor.appendChild(br)
          appendZwsp()
        }
      }
      continue
    }

    const last = editor.lastChild
    if (!last || last.nodeType === Node.ELEMENT_NODE) appendZwsp()

    const iconClass = opts.getContextIcon(node.context).class
    const chip = createContextChipElement(node.context, iconClass, opts.chipHandlers)
    editor.appendChild(chip)
  }

  if (editor.lastChild && editor.lastChild.nodeType === Node.ELEMENT_NODE) {
    appendZwsp()
  }

  queueMicrotask(() => {
    if (!savedRange) return

    try {
      const newSelection = window.getSelection()
      if (!newSelection) return

      const range = document.createRange()
      range.selectNodeContents(editor)
      range.collapse(false)
      newSelection.removeAllRanges()
      newSelection.addRange(range)
    } catch {
      // ignore
    }
  })
}
