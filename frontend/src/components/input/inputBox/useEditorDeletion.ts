export type OnContextRemoved = (removedId: string) => void

function isContextChipNode(n: Node | null | undefined): n is HTMLElement {
  return !!n && n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).classList.contains('context-chip')
}

function isZwspTextNode(n: Node | null | undefined): n is Text {
  return !!n && n.nodeType === Node.TEXT_NODE && (n as Text).data === '\u200B'
}

function setCaretAfterNode(selection: Selection, editor: HTMLElement, before: Node | null) {
  const newRange = document.createRange()
  if (!before) {
    newRange.setStart(editor, 0)
  } else if (before.nodeType === Node.TEXT_NODE) {
    const t = before as Text
    newRange.setStart(t, t.data.length)
  } else {
    newRange.setStartAfter(before)
  }
  newRange.collapse(true)
  selection.removeAllRanges()
  selection.addRange(newRange)
}

export function removeLineBreakBackward(editor: HTMLElement): boolean {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return false

  const range = selection.getRangeAt(0)
  if (!range.collapsed) return false
  if (range.startContainer !== editor && !editor.contains(range.startContainer)) return false

  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    const t = range.startContainer as Text

    if (t.data === '\u200B' && range.startOffset === 1) {
      const prev = t.previousSibling
      if (prev && prev.nodeType === Node.ELEMENT_NODE) {
        const el = prev as HTMLElement
        if (el.tagName === 'BR' && el.dataset.limBreak === '1') {
          const before = el.previousSibling

          range.setStartBefore(el)
          range.collapse(true)
          t.remove()
          el.remove()

          const newRange = document.createRange()
          if (before) {
            if (before.nodeType === Node.TEXT_NODE) {
              const bt = before as Text
              newRange.setStart(bt, bt.data.length)
            } else {
              newRange.setStartAfter(before)
            }
          } else {
            newRange.setStart(editor, 0)
          }
          newRange.collapse(true)
          selection.removeAllRanges()
          selection.addRange(newRange)
          return true
        }
      }
    }

    if (t.data === '\u200B' && range.startOffset === 0) {
      const prev = t.previousSibling
      if (prev && prev.nodeType === Node.ELEMENT_NODE) {
        const el = prev as HTMLElement
        if (el.tagName === 'BR' && el.dataset.limBreak === '1') {
          const before = el.previousSibling
          el.remove()
          setCaretAfterNode(selection, editor, before)
          return true
        }
      }
    }

    if (range.startOffset === 0) {
      const prev = t.previousSibling
      if (prev && prev.nodeType === Node.ELEMENT_NODE) {
        const el = prev as HTMLElement
        if (el.tagName === 'BR' && el.dataset.limBreak === '1') {
          el.remove()
          const newRange = document.createRange()
          newRange.setStart(t, 0)
          newRange.collapse(true)
          selection.removeAllRanges()
          selection.addRange(newRange)
          return true
        }
      }
    }
  }

  if (range.startContainer === editor) {
    const offset = range.startOffset
    if (offset > 0) {
      const prev = editor.childNodes[offset - 1]

      if (prev && prev.nodeType === Node.TEXT_NODE && (prev as Text).data === '\u200B' && offset > 1) {
        const maybeBr = editor.childNodes[offset - 2]
        if (maybeBr && maybeBr.nodeType === Node.ELEMENT_NODE) {
          const brEl = maybeBr as HTMLElement
          if (brEl.tagName === 'BR' && brEl.dataset.limBreak === '1') {
            brEl.remove()
            prev.remove()
            const newRange = document.createRange()
            newRange.setStart(editor, Math.min(offset - 2, editor.childNodes.length))
            newRange.collapse(true)
            selection.removeAllRanges()
            selection.addRange(newRange)
            return true
          }
        }
      }

      if (prev && prev.nodeType === Node.ELEMENT_NODE) {
        const el = prev as HTMLElement
        if (el.tagName === 'BR' && el.dataset.limBreak === '1') {
          el.remove()
          const maybeZwsp = editor.childNodes[offset - 1]
          if (maybeZwsp && maybeZwsp.nodeType === Node.TEXT_NODE && (maybeZwsp as Text).data === '\u200B') {
            maybeZwsp.remove()
          }
          const newRange = document.createRange()
          newRange.setStart(editor, Math.min(offset - 1, editor.childNodes.length))
          newRange.collapse(true)
          selection.removeAllRanges()
          selection.addRange(newRange)
          return true
        }
      }
    }
  }

  return false
}

export function removeLineBreakForward(editor: HTMLElement): boolean {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return false

  const range = selection.getRangeAt(0)
  if (!range.collapsed) return false
  if (range.startContainer !== editor && !editor.contains(range.startContainer)) return false

  if (range.startContainer === editor) {
    const offset = range.startOffset
    const next = editor.childNodes[offset]
    if (next && next.nodeType === Node.ELEMENT_NODE) {
      const el = next as HTMLElement
      if (el.tagName === 'BR' && el.dataset.limBreak === '1') {
        el.remove()
        const maybeZwsp = editor.childNodes[offset]
        if (maybeZwsp && maybeZwsp.nodeType === Node.TEXT_NODE && (maybeZwsp as Text).data === '\u200B') {
          maybeZwsp.remove()
        }
        return true
      }
    }
  }

  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    const t = range.startContainer as Text
    if (t.data === '\u200B' && range.startOffset === 0) {
      const next = t.nextSibling
      if (next && next.nodeType === Node.ELEMENT_NODE) {
        const el = next as HTMLElement
        if (el.tagName === 'BR' && el.dataset.limBreak === '1') {
          t.remove()
          el.remove()
          return true
        }
      }
    }
  }

  return false
}

export function removeContextBackward(editor: HTMLElement, onContextRemoved?: OnContextRemoved): boolean {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return false

  const range = selection.getRangeAt(0)
  if (!range.collapsed) return false
  if (range.startContainer !== editor && !editor.contains(range.startContainer)) return false

  if (range.startContainer === editor) {
    let idx = range.startOffset - 1
    if (idx < 0) return false

    let prev: Node | null = editor.childNodes[idx] || null
    if (isZwspTextNode(prev)) {
      idx -= 1
      prev = idx >= 0 ? (editor.childNodes[idx] || null) : null
    }

    if (!prev) {
      return true
    }

    if (isContextChipNode(prev)) {
      const removedId = prev.dataset.contextId
      const before = prev.previousSibling
      prev.remove()
      setCaretAfterNode(selection, editor, before)

      if (removedId) onContextRemoved?.(removedId)

      return true
    }

    return false
  }

  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    const t = range.startContainer as Text

    if (t.data === '\u200B') {
      if (range.startOffset === 0 || range.startOffset === 1) {
        let prev: Node | null = t.previousSibling
        if (isZwspTextNode(prev)) prev = prev.previousSibling

        if (prev && prev.nodeType === Node.ELEMENT_NODE) {
          const el = prev as HTMLElement
          if (el.tagName === 'BR' && el.dataset.limBreak === '1') return false
        }

        if (!prev) return true

        if (isContextChipNode(prev)) {
          const removedId = prev.dataset.contextId
          const before = prev.previousSibling
          prev.remove()
          setCaretAfterNode(selection, editor, before)
          if (removedId) onContextRemoved?.(removedId)
          return true
        }
      }
      return false
    }

    if (range.startOffset !== 0) return false

    let prev: Node | null = t.previousSibling
    if (isZwspTextNode(prev)) prev = prev.previousSibling

    if (isContextChipNode(prev)) {
      const removedId = prev.dataset.contextId
      const before = prev.previousSibling
      prev.remove()
      setCaretAfterNode(selection, editor, before)
      if (removedId) onContextRemoved?.(removedId)
      return true
    }
  }

  return false
}

export function removeContextForward(editor: HTMLElement, onContextRemoved?: OnContextRemoved): boolean {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return false

  const range = selection.getRangeAt(0)
  if (!range.collapsed) return false
  if (range.startContainer !== editor && !editor.contains(range.startContainer)) return false

  if (range.startContainer === editor) {
    let idx = range.startOffset
    if (idx < 0) return false

    let next: Node | null = editor.childNodes[idx] || null
    const skippedZwsp = isZwspTextNode(next)
    if (skippedZwsp) {
      idx += 1
      next = editor.childNodes[idx] || null
    }

    if (!next && skippedZwsp) {
      return true
    }

    if (isContextChipNode(next)) {
      const removedId = next.dataset.contextId
      next.remove()
      if (removedId) onContextRemoved?.(removedId)
      return true
    }

    return false
  }

  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    const t = range.startContainer as Text

    if (t.data === '\u200B') {
      if (range.startOffset === 0 || range.startOffset === 1) {
        let next: Node | null = t.nextSibling
        if (isZwspTextNode(next)) next = next.nextSibling

        if (next && next.nodeType === Node.ELEMENT_NODE) {
          const el = next as HTMLElement
          if (el.tagName === 'BR' && el.dataset.limBreak === '1') return false
        }

        if (!next) return true

        if (isContextChipNode(next)) {
          const removedId = next.dataset.contextId
          next.remove()
          if (removedId) onContextRemoved?.(removedId)
          return true
        }
      }
      return false
    }

    if (range.startOffset !== t.data.length) return false

    let next: Node | null = t.nextSibling
    if (isZwspTextNode(next)) next = next.nextSibling

    if (isContextChipNode(next)) {
      const removedId = next.dataset.contextId
      next.remove()
      if (removedId) onContextRemoved?.(removedId)
      return true
    }
  }

  return false
}
