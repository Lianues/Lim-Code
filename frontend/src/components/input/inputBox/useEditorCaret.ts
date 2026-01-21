export interface DomPoint {
  container: Node
  offset: number
}

export function getRangeInEditor(editor: HTMLElement): Range | null {
  const selection = window.getSelection()
  if (!selection) return null

  editor.focus()

  if (selection.rangeCount === 0) {
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  } else {
    const range = selection.getRangeAt(0)
    if (!editor.contains(range.startContainer)) {
      const newRange = document.createRange()
      newRange.selectNodeContents(editor)
      newRange.collapse(false)
      selection.removeAllRanges()
      selection.addRange(newRange)
    }
  }

  return selection.getRangeAt(0)
}

export function getCaretTextOffset(editor: HTMLElement): number {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return 0

  const range = selection.getRangeAt(0)
  const preRange = range.cloneRange()
  preRange.selectNodeContents(editor)
  preRange.setEnd(range.startContainer, range.startOffset)

  let offset = 0
  const fragment = preRange.cloneContents()

  function countText(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const raw = node.textContent || ''
      offset += raw.replace(/\u200B/g, '').length
      return
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return

    const el = node as HTMLElement

    if (el.tagName === 'BR') {
      if (el.dataset.limBreak === '1') offset += 1
      return
    }

    if (el.classList.contains('context-chip')) return

    for (const child of Array.from(node.childNodes)) countText(child)
  }

  for (const child of Array.from(fragment.childNodes)) countText(child)

  return offset
}

export function insertTextAtCaret(editor: HTMLElement, text: string): boolean {
  const range = getRangeInEditor(editor)
  const selection = window.getSelection()
  if (!range || !selection) return false

  range.deleteContents()

  const textNode = document.createTextNode(text)
  range.insertNode(textNode)

  range.setStartAfter(textNode)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)

  return true
}

export function insertLineBreakAtCaret(editor: HTMLElement): boolean {
  const range = getRangeInEditor(editor)
  const selection = window.getSelection()
  if (!range || !selection) return false

  range.deleteContents()

  const br = document.createElement('br')
  br.dataset.limBreak = '1'
  range.insertNode(br)

  const zwsp = document.createTextNode('\u200B')
  range.setStartAfter(br)
  range.collapse(true)
  range.insertNode(zwsp)

  range.setStart(zwsp, 1)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)

  return true
}

export function insertPlainTextWithLineBreaksAtCaret(editor: HTMLElement, text: string): boolean {
  const normalized = text.replace(/\r\n/g, '\n')
  const parts = normalized.split('\n')

  for (let i = 0; i < parts.length; i++) {
    if (parts[i]) insertTextAtCaret(editor, parts[i])
    if (i < parts.length - 1) insertLineBreakAtCaret(editor)
  }

  return true
}

function getDomPointFromTextOffset(editor: HTMLElement, targetOffset: number): DomPoint {
  let textCount = 0
  const children = Array.from(editor.childNodes)

  for (let i = 0; i < children.length; i++) {
    const child = children[i]

    if (targetOffset === textCount) {
      return { container: editor, offset: i }
    }

    if (child.nodeType === Node.TEXT_NODE) {
      const t = child as Text
      const raw = t.data
      const logicalLen = raw.replace(/\u200B/g, '').length

      if (targetOffset <= textCount + logicalLen) {
        const need = targetOffset - textCount
        let seen = 0
        for (let j = 0; j <= raw.length; j++) {
          if (seen === need) {
            return { container: t, offset: j }
          }
          const ch = raw[j]
          if (ch && ch !== '\u200B') seen += 1
        }
        return { container: t, offset: raw.length }
      }

      textCount += logicalLen
      continue
    }

    if (child.nodeType !== Node.ELEMENT_NODE) continue

    const el = child as HTMLElement

    if (el.tagName === 'BR' && el.dataset.limBreak === '1') {
      if (targetOffset === textCount + 1) {
        return { container: editor, offset: i + 1 }
      }
      textCount += 1
      continue
    }

    if (el.classList.contains('context-chip')) {
      continue
    }
  }

  return { container: editor, offset: editor.childNodes.length }
}

export function replaceTextRangeByOffsets(
  editor: HTMLElement,
  startOffset: number,
  endOffset: number,
  replacement: string = ''
) {
  const start = getDomPointFromTextOffset(editor, startOffset)
  const end = getDomPointFromTextOffset(editor, endOffset)

  const range = document.createRange()
  range.setStart(start.container, start.offset)
  range.setEnd(end.container, end.offset)
  range.deleteContents()

  if (replacement) {
    const textNode = document.createTextNode(replacement)
    range.insertNode(textNode)
    range.setStartAfter(textNode)
  }

  range.collapse(true)
  const selection = window.getSelection()
  if (selection) {
    selection.removeAllRanges()
    selection.addRange(range)
  }
}
