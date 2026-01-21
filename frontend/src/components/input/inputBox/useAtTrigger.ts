import { ref } from 'vue'

export type AtPickerKey = 'ArrowUp' | 'ArrowDown' | 'Enter'

export interface UseAtTriggerCallbacks {
  onOpen?: (query: string, triggerPosition: number) => void
  onClose?: () => void
  onQueryChange?: (query: string) => void
  onPickerKeydown?: (key: AtPickerKey) => void
}

export interface ReplaceAtTriggerDeps {
  getCaretTextOffset: (editor: HTMLElement) => number
  replaceTextRangeByOffsets: (
    editor: HTMLElement,
    startOffset: number,
    endOffset: number,
    replacement?: string
  ) => void
}

/**
 * Tracks the "@" trigger state machine for the contenteditable editor.
 * It is intentionally text/caret-offset based, so it stays independent of DOM structure.
 */
export function useAtTrigger(callbacks: UseAtTriggerCallbacks = {}) {
  const atTriggerPosition = ref<number | null>(null)
  const atQueryEndPosition = ref<number | null>(null)

  function reset() {
    atTriggerPosition.value = null
    atQueryEndPosition.value = null
  }

  function closeAndNotify() {
    if (atTriggerPosition.value === null) return
    reset()
    callbacks.onClose?.()
  }

  function onTextChanged(text: string, caretOffset: number) {
    if (atTriggerPosition.value !== null) {
      const triggerPos = atTriggerPosition.value
      const query = text.substring(triggerPos + 1, caretOffset)

      // Close when caret moves before '@' or query contains separators.
      if (caretOffset <= triggerPos || query.includes(' ') || query.includes('\n')) {
        closeAndNotify()
        return
      }

      atQueryEndPosition.value = caretOffset
      callbacks.onQueryChange?.(query)
      return
    }

    const charBefore = text[caretOffset - 2] || ''
    const currentChar = text[caretOffset - 1] || ''

    if (currentChar === '@' && (charBefore === '' || charBefore === ' ' || charBefore === '\n')) {
      atTriggerPosition.value = caretOffset - 1
      atQueryEndPosition.value = caretOffset
      callbacks.onOpen?.('', caretOffset - 1)
    }
  }

  /**
   * Handle keyboard events while "@" picker is active.
   * Returns true when the event is consumed.
   */
  function handleKeydown(event: KeyboardEvent): boolean {
    if (atTriggerPosition.value === null) return false

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      callbacks.onPickerKeydown?.(event.key)
      return true
    }

    if (event.key === 'Tab' || event.key === 'Enter') {
      event.preventDefault()
      callbacks.onPickerKeydown?.('Enter')
      return true
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      closeAndNotify()
      return true
    }

    return false
  }

  function replaceAtTrigger(editor: HTMLElement, replacement: string, deps: ReplaceAtTriggerDeps): boolean {
    if (atTriggerPosition.value === null) return false

    const triggerPos = atTriggerPosition.value
    const cursorPos = atQueryEndPosition.value ?? deps.getCaretTextOffset(editor)
    const endPos = Math.max(cursorPos, triggerPos + 1)

    editor.focus()
    deps.replaceTextRangeByOffsets(editor, triggerPos, endPos, replacement)

    closeAndNotify()
    return true
  }

  function getAtTriggerPosition(): number | null {
    return atTriggerPosition.value
  }

  return {
    atTriggerPosition,
    atQueryEndPosition,

    reset,
    closeAndNotify,
    onTextChanged,
    handleKeydown,
    replaceAtTrigger,
    getAtTriggerPosition
  }
}
