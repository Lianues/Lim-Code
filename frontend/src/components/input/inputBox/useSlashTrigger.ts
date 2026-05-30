import { ref } from 'vue'
import type { AtPickerKey, ReplaceAtTriggerDeps } from './useAtTrigger'

export interface UseSlashTriggerCallbacks {
  onOpen?: (query: string, triggerPosition: number) => void
  onClose?: () => void
  onQueryChange?: (query: string) => void
  onPickerKeydown?: (key: AtPickerKey) => void
}

export function useSlashTrigger(callbacks: UseSlashTriggerCallbacks = {}) {
  const slashTriggerPosition = ref<number | null>(null)
  const slashQueryEndPosition = ref<number | null>(null)

  function reset() {
    slashTriggerPosition.value = null
    slashQueryEndPosition.value = null
  }

  function closeAndNotify() {
    if (slashTriggerPosition.value === null) return
    reset()
    callbacks.onClose?.()
  }

  function isBoundaryBefore(text: string, slashOffset: number): boolean {
    if (slashOffset === 0) return true
    const prev = text[slashOffset - 1] || ''
    return /\s/.test(prev)
  }

  function shouldSuppress(text: string, slashOffset: number): boolean {
    const before = text.slice(Math.max(0, slashOffset - 10), slashOffset)
    const after = text.slice(slashOffset, slashOffset + 12)
    if (before.endsWith(':')) return true // URL scheme like https:/
    if (after.startsWith('//')) return true
    const prev = text[slashOffset - 1] || ''
    const next = text[slashOffset + 1] || ''
    if (/\d/.test(prev) && /\d/.test(next)) return true
    return false
  }

  function onTextChanged(text: string, caretOffset: number) {
    if (slashTriggerPosition.value !== null) {
      const triggerPos = slashTriggerPosition.value
      const query = text.substring(triggerPos + 1, caretOffset)
      if (caretOffset <= triggerPos || query.includes('\n')) {
        closeAndNotify()
        return
      }
      slashQueryEndPosition.value = caretOffset
      callbacks.onQueryChange?.(query)
      return
    }

    const currentChar = text[caretOffset - 1] || ''
    const slashOffset = caretOffset - 1
    if (currentChar === '/' && isBoundaryBefore(text, slashOffset) && !shouldSuppress(text, slashOffset)) {
      slashTriggerPosition.value = slashOffset
      slashQueryEndPosition.value = caretOffset
      callbacks.onOpen?.('', slashOffset)
    }
  }

  function isOpen(): boolean {
    // 修改原因：InputBox 需要区分“斜杠面板打开且命令已完整输入”和“普通 Enter 发送”，否则 `/context-status` 首次 Enter 会被误当成补全。
    // 修改方式：只暴露只读 open 状态，不暴露内部位置或查询细节，避免调用方绕过触发器状态机。
    // 修改目的：让完整 context command 可以直接执行，同时保持部分命令补全仍由 useSlashTrigger 统一管理。
    return slashTriggerPosition.value !== null
  }

  function handleKeydown(event: KeyboardEvent): boolean {
    if (slashTriggerPosition.value === null) return false
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

  function replaceSlashTrigger(
    editor: HTMLElement,
    replacement: string,
    deps: ReplaceAtTriggerDeps,
    options: { keepOpen?: boolean } = {}
  ): boolean {
    if (slashTriggerPosition.value === null) return false
    const triggerPos = slashTriggerPosition.value
    const cursorPos = slashQueryEndPosition.value ?? deps.getCaretTextOffset(editor)
    const endPos = Math.max(cursorPos, triggerPos + 1)
    editor.focus()
    deps.replaceTextRangeByOffsets(editor, triggerPos, endPos, replacement)

    // 为什么要保留打开状态：Tab/Enter 补全 `/skill` 后，用户还需要继续输入 Skill 名称。
    // 怎么做：这里只更新查询末端位置，不主动发布 query；DOM 替换后由 InputBox.handleInput 统一调用 onTextChanged 发布唯一一次 query。
    // 目的：避免补全阶段先同步发布 query、随后输入同步再次发布 query，导致 slash 面板在 command/skill 两个内容分支间出现一次多余重绘。
    if (options.keepOpen) {
      slashQueryEndPosition.value = triggerPos + replacement.length
      return true
    }

    closeAndNotify()
    return true
  }

  return {
    reset,
    closeAndNotify,
    onTextChanged,
    handleKeydown,
    replaceSlashTrigger,
    isOpen
  }
}
